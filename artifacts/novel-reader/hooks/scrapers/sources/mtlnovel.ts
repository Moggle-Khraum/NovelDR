// hooks/scrapers/sources/mtlnovel.ts
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

const BASE_HOST = "mtl-novel.com";

/**
 * Pure parser for the novel info page. No network.
 */
export const parseMtlNovelMeta = (html: string, url: string): NovelMeta => {
  // <h1 class="entry-title">Title</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "Unknown Title";

  // <table class="info"> <tr><td class="tbl-lbl">Author</td><td>Name</td></tr>
  const authorRaw = safeMatch(
    html,
    /<td class="tbl-lbl">\s*Author\s*<\/td>\s*<td>\s*([\s\S]*?)\s*<\/td>/i,
  );
  const author =
    authorRaw && decodeEntities(stripTags(authorRaw)).trim()
      ? decodeEntities(stripTags(authorRaw)).replace(/\s+/g, " ").trim()
      : "Unknown Author";

  // The cover is lazy-loaded: the real URL is in data-src, src is a GIF placeholder.
  const coverUrl =
    safeMatch(html, /<img[^>]*data-src="([^"]+)"[^>]*class="[^"]*main-tmb/i) ??
    safeMatch(html, /<img[^>]*class="[^"]*main-tmb[^"]*"[^>]*src="([^"]+)"/i) ??
    "";

  // <div class="desc"> <h2>Novel Summary</h2> <p>...</p> ... </div>
  const descBlock = extractByDepth(html, 'class="desc"') ?? "";
  const synopsis = decodeEntities(extractParagraphs(descBlock)).trim();

  // <a class="but" href="…/chapter-1-…/">Start Reading</a>
  const firstRaw = safeMatch(
    html,
    /<a class="but"[^>]*href="([^"]+)"[^>]*>\s*Start Reading/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: mtl-novel"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseMtlNovelChapter = (html: string, url: string): ChapterData => {
  // <h1 class="main-title">Chapter 1: Title</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="main-title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "";

  // <div class="par" id="chapter-par"> …<p>paragraphs</p>… </div>
  const contentBlock = extractByDepth(html, 'id="chapter-par"') ?? "";
  const content = extractParagraphs(contentBlock);

  // <a class="next" href="…/chapter-2-…/">Next »</a>
  const nextRaw = safeMatch(html, /<a class="next"[^>]*href="([^"]+)"/i);
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const mtlNovelScraper: SourceScraper = {
  id: "mtlnovel-com",
  name: "MTL-Novel",

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
    return parseMtlNovelMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseMtlNovelChapter(html, url);
  },
};
