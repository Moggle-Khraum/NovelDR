// hooks/scrapers/sources/meionovels.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";
import { extractParagraphs } from "./novelphoenix";

const BASE_HOST = "meionovels.com";

/**
 * Pure parser for the novel info page (Madara theme). No network.
 */
export const parseMeioNovelsMeta = (html: string, url: string): NovelMeta => {
  // <h1>Title</h1> (plain h1 in the novel header)
  const titleRaw = safeMatch(html, /<h1>\s*([^<]+?)\s*<\/h1>/i);
  const title = titleRaw ? decodeEntities(titleRaw).trim() : "Unknown Title";

  // <div class="author-content"><a href="...">Author</a></div>
  const authorRaw = safeMatch(
    html,
    /<div class="author-content">\s*<a[^>]*>([^<]+)<\/a>/i,
  );
  const author = authorRaw
    ? decodeEntities(authorRaw).trim()
    : "Unknown Author";

  // <meta property="og:image" content="...">
  const coverUrl =
    safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ?? "";

  // <div class="summary__content show-more"> <p>...</p> </div>
  const synBlock =
    extractByDepth(html, 'class="summary__content show-more"') ?? "";
  const synopsis = decodeEntities(extractParagraphs(synBlock)).trim();

  // The "Read First" button points at chapter 1. Its element id is swapped
  // on the site, so match by the visible text instead.
  const firstRaw = safeMatch(
    html,
    /<a href="([^"]+)"[^>]*>\s*Read First\s*<\/a>/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: meionovels"],
  };
};

/**
 * Pure parser for a chapter page (Madara theme). No network.
 */
export const parseMeioNovelsChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <h1 id="chapter-heading">Novel - MTL - Chapter 1</h1>
  const titleRaw = safeMatch(
    html,
    /<h1 id="chapter-heading">\s*([^<]+?)\s*<\/h1>/i,
  );
  const title = titleRaw ? decodeEntities(titleRaw).trim() : "";

  // <div class="reading-content"> ... <p>paragraphs</p> ... </div>
  const contentBlock = extractByDepth(html, 'class="reading-content"') ?? "";
  const content = extractParagraphs(contentBlock);

  // <a href="..." class="btn next_page" title="Chapter 2">
  const nextRaw = safeMatch(
    html,
    /<a href="([^"]+)"[^>]*class="btn next_page"/i,
  );
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const meioNovelsScraper: SourceScraper = {
  id: "meionovels",
  name: "MeioNovels",

  canHandle: (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === BASE_HOST || host.endsWith(`.${BASE_HOST}`);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);
    return parseMeioNovelsMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseMeioNovelsChapter(html, url);
  },
};
