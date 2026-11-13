// Builds the chapter list used by every export format (TXT, PDF, RTF, EPUB,
// DOCX, ...). All formats read through this one function.
//
// Chapter files are stored by their position in novel.chapters. Each file is
// therefore read with the chapter's original index, never its index in the
// sorted list.

import { orderChapters } from "./chapterOrder";

export type ExportChapterSource = {
  title: string;
  url: string;
  content?: string;
};

export type StoredChapterFile = {
  title?: string;
  content?: string;
};

export type ExportChapter = { title: string; content: string };

export type ExportChapterResult = {
  chapters: ExportChapter[];
  missingCount: number;
};

export const MISSING_CONTENT_MESSAGE =
  "[This chapter has no saved content. Re-download it from the Updates tab.]";

// Any non-empty text counts as real content. There is no minimum length, so
// short chapters are kept.
export function hasContent(text: string | undefined | null): text is string {
  return typeof text === "string" && text.trim().length > 0;
}

export async function loadExportChapters(
  chapters: ExportChapterSource[],
  readStoredFile: (index: number) => Promise<StoredChapterFile | null>,
  readLegacyContent: (url: string) => Promise<StoredChapterFile | null>,
): Promise<ExportChapterResult> {
  // Keep each chapter's original index so its file can still be found after
  // reordering.
  const indexed = chapters.map((chapter, index) => ({ ...chapter, index }));

  // Drop repeated entries for the same URL, keeping the first one in reading
  // order. Nothing else is dropped: unnumbered chapters are all kept.
  const seenUrls = new Set<string>();
  const unique = indexed.filter((chapter) => {
    if (!chapter.url) return true;
    if (seenUrls.has(chapter.url)) return false;
    seenUrls.add(chapter.url);
    return true;
  });

  const ordered = orderChapters(unique);

  const result: ExportChapter[] = [];
  let missingCount = 0;

  for (let position = 0; position < ordered.length; position++) {
    const chapter = ordered[position];
    let title = chapter.title || `Chapter ${position + 1}`;
    let content: string | null = null;

    // 1. The chapter's own file, at its original index.
    const stored = await readStoredFile(chapter.index);
    if (stored && hasContent(stored.content)) {
      content = stored.content;
      if (stored.title) title = stored.title;
    }

    // 2. Legacy storage, matched by URL.
    if (!content) {
      const legacy = await readLegacyContent(chapter.url);
      if (legacy && hasContent(legacy.content)) {
        content = legacy.content;
        if (legacy.title) title = legacy.title;
      }
    }

    // 3. In-memory copy.
    if (!content && hasContent(chapter.content)) {
      content = chapter.content;
    }

    if (!content) {
      missingCount++;
      content = MISSING_CONTENT_MESSAGE;
    }

    result.push({ title, content });
  }

  return { chapters: result, missingCount };
}
