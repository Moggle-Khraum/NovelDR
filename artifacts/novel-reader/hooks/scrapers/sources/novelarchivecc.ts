// hooks/scrapers/sources/novelarchivecc.ts
// NovelArchive.cc — API-based source (unlike most sources here, which scrape
// server-rendered HTML). Endpoints reverse-engineered from the lnreader
// plugin; verified against a live Python tester before porting to TS.

import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchJsonWithFallback } from "../shared/http";
import { decodeEntities, stripTags } from "../shared/html";

const BASE_HOST = "novelarchive.cc";
const BASE_URL = "https://novelarchive.cc";
const API_BASE = `${BASE_URL}/api`;

/** Extract a novel ID from a novelarchive.cc URL (?id=... or /novel/<id>). */
const extractNovelId = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);

    const idParam = parsedUrl.searchParams.get("id");
    if (idParam) return idParam;

    const pathMatch = parsedUrl.pathname.match(/\/novel(?:s)?\/([^/?]+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    return null;
  } catch {
    return null;
  }
};

/** Extract a novel ID from an internally-built /api/novels/<id>/... URL. */
const extractNovelIdFromApiUrl = (url: string): string | null => {
  const match = url.match(/\/api\/novels\/([^/?]+)/);
  return match ? match[1] : null;
};

/** Strip any HTML tags API fields may contain but preserve formatting for synopsis. */
const cleanContent = (text: string, isDescription: boolean = false): string => {
  if (!text) return "";
  let cleaned = decodeEntities(stripTags(text));
  
  // For descriptions/synopsis: preserve newlines, only collapse excessive whitespace
  if (isDescription) {
    cleaned = cleaned
      .replace(/\n\s*\n\s*\n/g, "\n\n") // Preserve double newlines
      .replace(/\s+/g, " ") // Collapse runs of spaces but keep single spaces
      .trim();
  } else {
    // For chapter content: collapse blank lines
    cleaned = cleaned
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }
  
  return cleaned;
};

export const novelArchiveCcScraper: SourceScraper = {
  id: "novelarchivecc",
  name: "NovelArchive.cc",

  canHandle: (url: string): boolean => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === BASE_HOST || hostname.endsWith(`.${BASE_HOST}`);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const novelId = extractNovelId(url);
    if (!novelId) {
      throw new Error(
        `novelarchivecc: could not extract novel ID from: ${url}`,
      );
    }

    const data = await fetchJsonWithFallback<{ novel?: Record<string, any> }>(
      `${API_BASE}/novels/${encodeURIComponent(novelId)}`,
    );

    const novel = data?.novel;
    if (!novel) {
      throw new Error(
        `novelarchivecc: novel data not found in response for ID: ${novelId}`,
      );
    }

    const title = novel.title || "Unknown Title";
    const author = novel.author || "Unknown Author";
    const synopsis = cleanContent(novel.description || "", true);
    
    // Make cover URL absolute if it's relative
    let coverUrl = novel.cover_url || novel.novel_image || novel.image_url || "";
    if (coverUrl && !coverUrl.startsWith("http")) {
      coverUrl = `${BASE_URL}${coverUrl.startsWith("/") ? "" : "/"}${coverUrl}`;
    }
    
    const totalChapters = parseInt(novel.total_chapters, 10) || 0;

    // The API is chapter-number-indexed rather than link-based, so the
    // "first chapter URL" is a constructed API endpoint, not a page link —
    // fetchChapter below knows how to parse novelId back out of it.
    const firstChapterUrl =
      totalChapters > 0
        ? `${API_BASE}/novels/${encodeURIComponent(novelId)}/chapters/1`
        : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: novelarchivecc"],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const novelId = url.includes("/api/novels/")
      ? extractNovelIdFromApiUrl(url)
      : extractNovelId(url);

    if (!novelId) {
      throw new Error(
        `novelarchivecc: could not extract novel ID from chapter URL: ${url}`,
      );
    }

    const data = await fetchJsonWithFallback<{ chapter?: Record<string, any> }>(
      `${API_BASE}/novels/${encodeURIComponent(novelId)}/chapters/${chapterNum}`,
    );

    const chapter = data?.chapter;
    if (!chapter) {
      throw new Error(
        `novelarchivecc: chapter data not found in response for chapter ${chapterNum}`,
      );
    }

    const content = cleanContent(chapter.content || "");
    if (!content) {
      throw new Error(
        `novelarchivecc: chapter ${chapterNum} has no content (may be unavailable)`,
      );
    }

    const title = chapter.name || `Chapter ${chapterNum}`;
    const nextUrl = `${API_BASE}/novels/${encodeURIComponent(novelId)}/chapters/${chapterNum + 1}`;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
    
