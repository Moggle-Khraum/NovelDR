// NovelArrow (novelarrow.com) — Next.js Server Components site.
// Content ships as RSC streaming payloads (self.__next_f.push([1, "..."]))
// instead of hydrated HTML, so we pull it out of inline <script> chunks
// rather than querying the DOM directly.

import type { SourceScraper, NovelMeta, ChapterData } from '../types';
import { fetchHtmlWithFallback } from '../shared/http';
import { stripTags, decodeEntities, safeMatch, makeAbsoluteUrl } from '../shared/html';

const BASE_HOST = 'novelarrow.com';

/** Pull every self.__next_f.push([1,"...']) chunk's decoded inner string out of raw HTML */
const extractRscChunks = (html: string): string[] => {
  const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const allScriptText = scriptBlocks.join('\n');

  const rawChunks = allScriptText.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];

  return rawChunks.map((chunk) => {
    const inner = chunk.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    let content = inner ? inner[1] : '';
    try {
      content = JSON.parse('"' + content + '"');
    } catch {
      content = content
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    return content;
  });
};

/** Extract every <p>...</p> from a block of (possibly chunk-embedded) HTML */
const extractParagraphs = (html: string): string => {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter(Boolean)
    .join('\n\n');
};

export const novelArrowScraper: SourceScraper = {
  id: 'novelarrow',
  name: 'NovelArrow',

  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.includes(BASE_HOST);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    // Head <meta> tags are still SSR'd for SEO even though body content is
    // RSC-streamed, so these are the most reliable source for novel-level info.
    const title = decodeEntities(
      safeMatch(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ??
        safeMatch(html, /<title>([^<]+)<\/title>/i) ??
        'Unknown Title',
    );

    const author = decodeEntities(
      safeMatch(html, /<meta[^>]*name="og:novel:author"[^>]*content="([^"]+)"/i) ??
        safeMatch(html, /<meta[^>]*property="og:novel:author"[^>]*content="([^"]+)"/i) ??
        'Unknown Author',
    );

    const synopsisMeta = safeMatch(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
    let synopsis = synopsisMeta ? decodeEntities(synopsisMeta) : '';

    const coverUrl =
      safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ?? '';

    // Fall back to RSC chunks for synopsis if the meta description was empty/truncated
    if (!synopsis) {
      const chunks = extractRscChunks(html);
      for (const chunk of chunks) {
        if (chunk.includes('<p>') && chunk.length > 300 && !chunk.includes('chapter')) {
          const paras = extractParagraphs(chunk);
          if (paras) {
            synopsis = paras;
            break;
          }
        }
      }
    }

    // First chapter link: look for a /chapter/{novelId}/... href in the raw HTML
    const firstChapterPath = safeMatch(html, /<a[^>]*href="(\/chapter\/[^"]+)"/i);
    const firstChapterUrl = firstChapterPath ? makeAbsoluteUrl(firstChapterPath, url) : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ['fetched via external scraper: novelarrow (meta-tag + RSC fallback)'],
    };
  },

  fetchChapter: async (url: string, _chapterNum: number): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    const chunks = extractRscChunks(html);

    // Find the chunk that actually holds the chapter's paragraph content
    let chapterHtml = '';
    for (const chunk of chunks) {
      if (chunk.includes('<p>') && chunk.includes('</p>') && chunk.length > 500) {
        chapterHtml = chunk;
        break;
      }
    }

    if (!chapterHtml) {
      throw new Error('novelarrow: could not locate chapter content in RSC chunks.');
    }

    // Title: try h1-h4 inside the chapter chunk first, then og:novel:chapter_name meta
    let title = '';
    for (const tag of ['h4', 'h3', 'h2', 'h1']) {
      const match = safeMatch(chapterHtml, new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
      if (match) {
        title = decodeEntities(match);
        break;
      }
    }
    if (!title) {
      title = decodeEntities(
        safeMatch(html, /<meta[^>]*name="og:novel:chapter_name"[^>]*content="([^"]+)"/i) ?? '',
      );
    }

    const content = extractParagraphs(chapterHtml);
    if (!content) {
      throw new Error('novelarrow: chapter chunk found but no <p> paragraphs extracted.');
    }

    // Next chapter: pulled from the escaped nextChapter.chapter_id payload embedded
    // in the RSC scripts, then rebuilt against the current novelId from the URL.
    let nextUrl: string | null = null;
    const urlMatch = url.match(/\/chapter\/([^/]+)\/([^/?#]+)/);
    const novelId = urlMatch ? urlMatch[1] : null;

    const allScriptText = chunks.join('\n');
    const nextChapterMatch = allScriptText.match(
      /\\?"nextChapter\\?"\s*:\s*\\?\{[^}]*\\?"chapter_id\\?"\s*:\s*\\?"([^"\\]+)\\?"/,
    );
    const nullNextMatch = allScriptText.match(/\\?"nextChapter\\?"\s*:\s*null/);

    if (nullNextMatch) {
      nextUrl = null;
    } else if (nextChapterMatch && novelId) {
      nextUrl = `https://${BASE_HOST}/chapter/${novelId}/${nextChapterMatch[1]}`;
    }

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
