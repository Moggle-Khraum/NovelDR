// hooks/scrapers/sources/novelarchivecc.ts
// NovelArchive.cc — API-based source (unlike most sources here, which scrape
// server-rendered HTML). Endpoints reverse-engineered from the lnreader
// plugin; verified against a live Python tester before porting to TS.

import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchJsonWithFallback, fetchHtmlWithFallback } from "../shared/http";
import { decodeEntities, stripTags } from "../shared/html";

const BASE_HOST = "novelarchive.st";
const BASE_URL = "https://novelarchive.st";
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

  // For descriptions/synopsis: preserve newlines and paragraph breaks
  if (isDescription) {
    cleaned = cleaned
      .replace(/\r\n/g, "\n") // Normalize line endings
      .replace(/\n\s*\n\s*\n+/g, "\n\n") // Collapse 3+ newlines to double newline (paragraph break)
      .split("\n") // Split into lines
      .map((line) => line.replace(/[ \t]+/g, " ").trim()) // Collapse spaces/tabs within each line only
      .filter((line) => line.length > 0) // Remove empty lines
      .join("\n")
      .trim();
  } else {
    // For chapter content: collapse blank lines
    cleaned = cleaned.replace(/\n\s*\n/g, "\n").trim();
  }

  return cleaned;
};

/**
 * Convert a synopsis's HTML into paragraph-separated plain text. stripTags()
 * collapses every tag and newline into a single space, which is why the
 * paragraph breaks disappeared, so breaks are turned into newlines first.
 */
const synopsisHtmlToText = (html: string): string => {
  if (!html) return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return withBreaks
    .split(/\r?\n/)
    .map((line) =>
      decodeEntities(line)
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n");
};

/**
 * The synopsis the site shows is rendered into the novel page as
 * <p id="novel-description">. Read it from there first; the API's description
 * field has stopped carrying it. Returns "" if the element isn't found.
 */
const synopsisFromPage = async (novelId: string): Promise<string> => {
  try {
    const html = await fetchHtmlWithFallback(
      `${BASE_URL}/novel?id=${encodeURIComponent(novelId)}`,
    );
    const match = html.match(/<p id="novel-description"[^>]*>([\s\S]*?)<\/p>/i);
    return match ? synopsisHtmlToText(match[1]) : "";
  } catch {
    return "";
  }
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
    let synopsis = await synopsisFromPage(novelId);
    if (!synopsis) {
      synopsis = synopsisHtmlToText(
        novel.description || novel.summary || novel.synopsis || "",
      );
    }

    // Make cover URL absolute if it's relative
    let coverUrl =
      novel.cover_url || novel.novel_image || novel.image_url || "";
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
      debugInfo: ["fetched via external scraper: novelarchivest"],
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
        `novelarchivest: could not extract novel ID from chapter URL: ${url}`,
      );
    }

    const data = await fetchJsonWithFallback<{ chapter?: Record<string, any> }>(
      `${API_BASE}/novels/${encodeURIComponent(novelId)}/chapters/${chapterNum}`,
    );

    const chapter = data?.chapter;
    if (!chapter) {
      throw new Error(
        `novelarchivest: chapter data not found in response for chapter ${chapterNum}`,
      );
    }

    const content = cleanContent(chapter.content || "");
    if (!content) {
      throw new Error(
        `novelarchivest: chapter ${chapterNum} has no content (may be unavailable)`,
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
