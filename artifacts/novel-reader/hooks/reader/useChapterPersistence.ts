// hooks/reader/useChapterPersistence.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decodeHTML } from 'entities';

// --- Types ---
export interface CachedChapter {
  content: string;
  paragraphs: string[];
  sentences: string[];
  processedAt: number;
  wordCount: number;
}

// --- Text processing helpers (copied verbatim) ---

const stripTags = (html: string): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const decodeEntities = (text: string): string => {
  if (!text) return '';
  try {
    return decodeHTML(text);
  } catch {
    return text;
  }
};

const safeMatch = (text: string, pattern: RegExp): string | null => {
  if (!text) return null;
  try {
    const match = text.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

function detectParagraphs(text: string): string[] {
  let normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  normalized = smartQuoteFormatting(normalized);
  normalized = removeDuplicateSpacing(normalized);
  normalized = stripDotLeaders(normalized);
  normalized = isolateStatLabels(normalized);
  normalized = isolateRuleHeadings(normalized);
  normalized = isolateBracketBlocks(normalized);

  const patterns = [
    /\n\s*\n+/,
    /\.\n(?=[A-Z])/,
    /[!?]\n(?=[A-Z])/,
    /\n(?=["“'‘])/,
    /\.\s{2,}(?=[A-Z])/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const paragraphs = normalized.split(pattern);
      if (
        paragraphs.length > 1 &&
        paragraphs.every((p) => p.trim().length > 0)
      ) {
        return paragraphs.map((p) => p.trim()).filter(Boolean);
      }
    }
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim(),
    )
    .filter(Boolean);
}

function stripDotLeaders(text: string): string {
  return text
    .replace(/[.\u2026]{4,}/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function isolateStatLabels(text: string): string {
  let result = text.replace(
    /(?:\[[^\[\]]*\]|【[^【】]*】)\s*:/g,
    (match) => `\n\n${match}`,
  );
  result = result.replace(
    /\b[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*){0,3}\s*:\s*(?=[\d★☆]|[A-Z][a-zA-Z])/g,
    (match) => `\n\n${match}`,
  );
  result = result.replace(
    /([★☆]+)[ \t]+(?!\n|\[|【)/g,
    (_match, stars) => `${stars}\n\n`,
  );
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function isolateRuleHeadings(text: string): string {
  return text
    .replace(
      /\s*(\bRule\s+[A-Za-z0-9]+\s*:\s*(?:\[[^\[\]]*\]|【[^【】]*】)?)\s*/g,
      '\n\n$1\n\n',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isolateBracketBlocks(text: string): string {
  return text
    .replace(/\[[^\[\]]*\]|【[^【】]*】/g, (match) => {
      const inner = match.slice(1, -1).trim();
      const wordCount = inner.split(/\s+/).filter(Boolean).length;
      const isSystemMessage = wordCount >= 3 || /[.,!?:;]/.test(inner);
      return isSystemMessage ? `\n\n${match}\n\n` : match;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function smartQuoteFormatting(text: string): string {
  let formatted = text;
  formatted = formatted.replace(/(\s|^)"/g, '$1“');
  formatted = formatted.replace(/"(\s|$)/g, '”$1');
  formatted = formatted.replace(/'(\s|$)/g, '’$1');
  formatted = formatted.replace(/(\s|^)'/g, '$1‘');
  formatted = formatted.replace(/(\w)'(\w)/g, '$1’$2');
  formatted = formatted.replace(/\.{3,}/g, '…');
  formatted = formatted.replace(/--+/g, '—');
  return formatted;
}

function removeDuplicateSpacing(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+(\n)/g, '$1')
    .replace(/(\n)[ \t]+/g, '$1')
    .trim();
}

function normalizeForSpeech(text: string): string {
  let clean = text.replace(/[""'']/g, '"');
  clean = clean.replace(/→|->|=>/g, ' to ');
  clean = clean.replace(/←|<-|<=/g, ' from ');
  clean = clean.replace(/↔|<->/g, ' between ');
  return clean.trim();
}

function splitSentencesWithLineBreaks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘\(\{\[<])/);
  return sentences.filter((s) => s.trim().length > 0);
}

// --- processChapterContent ---
export async function processChapterContent(content: string): Promise<CachedChapter> {
  if (!content.trim()) {
    return {
      content: '',
      paragraphs: [],
      sentences: [],
      processedAt: Date.now(),
      wordCount: 0,
    };
  }

  const paragraphs = detectParagraphs(content);
  const sentences = paragraphs.flatMap((p) =>
    splitSentencesWithLineBreaks(p).map(normalizeForSpeech),
  );
  const wordCount = content.split(/\s+/).length;
  return {
    content,
    paragraphs,
    sentences,
    processedAt: Date.now(),
    wordCount,
  };
}

// --- Hook ---
type UseChapterPersistenceProps = {
  novel: any;
  chapterIndex: number;
  loadChapterContent: (novelId: string, chapterIdx: number) => Promise<any>;
  saveChapterContent: (novelId: string, chapterIdx: number, title: string, url: string, content: string, chapterNumber: number) => Promise<void>;
};

export function useChapterPersistence({
  novel,
  chapterIndex,
  loadChapterContent,
  saveChapterContent,
}: UseChapterPersistenceProps) {
  const [chapterContent, setChapterContent] = useState<string>('');
  const [processedParagraphs, setProcessedParagraphs] = useState<string[]>([]);
  const [ttsSentences, setTtsSentences] = useState<string[]>([]);
  const [contentLoading, setContentLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadIdRef = useRef(0);
  const novelRef = useRef(novel);
  const chapterIndexRef = useRef(chapterIndex);
  const chapterRef = useRef(novel?.chapters[chapterIndex]);
  const chapterContentRef = useRef<string>('');
  const persistSnapshotRef = useRef({ index: chapterIndex, content: '' });

  useEffect(() => {
    novelRef.current = novel;
  }, [novel]);
  useEffect(() => {
    chapterIndexRef.current = chapterIndex;
  }, [chapterIndex]);
  useEffect(() => {
    chapterRef.current = novel?.chapters[chapterIndex];
  }, [novel, chapterIndex]);
  useEffect(() => {
    chapterContentRef.current = chapterContent;
  }, [chapterContent]);
  useEffect(() => {
    persistSnapshotRef.current = {
      index: chapterIndex,
      content: chapterContent,
    };
  }, [chapterIndex, chapterContent]);

  // Load effect
  useEffect(() => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;
    const currentLoadId = ++loadIdRef.current;

    if (!novel || !chapterRef.current) {
      setChapterContent('');
      setProcessedParagraphs([]);
      setTtsSentences([]);
      setContentLoading(false);
      return;
    }

    setChapterContent('');
    setProcessedParagraphs([]);
    setTtsSentences([]);
    setContentLoading(true);

    const load = async () => {
      try {
        if (signal.aborted || currentLoadId !== loadIdRef.current) return;

        let content = chapterRef.current?.content || '';
        if (!content && loadChapterContent) {
          const fileChapter = await loadChapterContent(novel.id, chapterIndex);
          if (signal.aborted || currentLoadId !== loadIdRef.current) return;
          content = fileChapter?.content || '';
        }

        const processed = await processChapterContent(content);
        if (signal.aborted || currentLoadId !== loadIdRef.current) return;

        setChapterContent(processed.content);
        setProcessedParagraphs(processed.paragraphs);
        setTtsSentences(processed.sentences);
      } catch {
        if (!signal.aborted && currentLoadId === loadIdRef.current) {
          setChapterContent('Error loading chapter content. Please try again.');
          setProcessedParagraphs([]);
        }
      } finally {
        if (!signal.aborted && currentLoadId === loadIdRef.current) {
          setContentLoading(false);
        }
      }
    };

    load();

    return () => {
      abortController.abort();
    };
  }, [chapterIndex, novel?.id, loadChapterContent]);

  // Persist chapter content
  const persistChapterContent = useCallback(async () => {
    const n = novelRef.current;
    const ch = chapterRef.current;
    const { index, content } = persistSnapshotRef.current;

    if (!n || !ch || !content) return;
    if (index !== chapterIndexRef.current) return;

    try {
      await saveChapterContent(
        n.id,
        index,
        ch.title,
        ch.url,
        content,
        ch.chapterNumber,
      );
      console.log(
        `[Reader] Chapter content persisted: ${n.title} - Chapter ${index}`,
      );
    } catch (error) {
      console.warn(`[Reader] Failed to persist chapter content:`, error);
    }
  }, [saveChapterContent]);

  // Save on background / unmount
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };
    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        (appStateRef.current === 'active' &&
          nextAppState.match(/inactive|background/)) ||
        nextAppState === 'background'
      ) {
        console.log('[Reader] App backgrounding - saving chapter content...');
        await persistChapterContent();
      } else if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        interactionTask?.cancel();
        interactionTask = InteractionManager.runAfterInteractions(() => {
          interactionTask = null;
        });
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      interactionTask?.cancel();
      persistChapterContent();
    };
  }, [persistChapterContent]);

  // Preload next chapter (kept as no-op)
  const preloadedIndexRef = useRef(-1);
  useEffect(() => {
    if (
      preloadedIndexRef.current !== chapterIndex &&
      novel &&
      chapterIndex + 1 < novel.chapters.length
    ) {
      preloadedIndexRef.current = chapterIndex;
      const nextChapter = novel.chapters[chapterIndex + 1];
      if (nextChapter && !nextChapter.content) {
        (async () => {
          const nextFileChapter = await loadChapterContent(novel.id, chapterIndex + 1);
          if (nextFileChapter?.content) {
            // unused, but kept for consistency
          }
        })();
      }
    }
  }, [novel, chapterIndex, loadChapterContent]);

  return {
    chapterContent,
    processedParagraphs,
    ttsSentences,
    contentLoading,
    persistChapterContent,
  };
}
