// hooks/scrapers/sources/centralnovel.ts
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

const BASE_HOST = "centralnovel.com";

/**
 * Pure parser for the series (novel info) page. No network.
 */
export const parseCentralNovelMeta = (html: string, url: string): NovelMeta => {
  // <h1 class="entry-title" itemprop="name">Title</h1> (nested <font> tags)
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="entry-title"[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "Unknown Title";

  // <span><b>Autor:</b> <a href="https://centralnovel.com/writer/<slug>/" rel="tag">Name</a></span>
  // Label is "Autor" on the Portuguese site; "Author" on translated copies.
  const authorRaw = safeMatch(
    html,
    /<b>(?:<font[^>]*>)*\s*(?:Autor|Author):?\s*(?:<\/font>)*<\/b>\s*<a[^>]*>(?:<font[^>]*>)*\s*([^<]+?)\s*(?:<\/font>)*<\/a>/i,
  );
  const author = authorRaw
    ? decodeEntities(authorRaw).trim()
    : "Unknown Author";

  // <img src="https://i*.wp.com/centralnovel.com/wp-content/uploads/..." ... itemprop="image">
  const coverUrl =
    safeMatch(html, /<img[^>]*src="([^"]+)"[^>]*itemprop="image"/i) ?? "";

  // <div class="entry-content" itemprop="description"> <p>...</p> </div>
  const synBlock =
    extractByDepth(html, 'class="entry-content" itemprop="description"') ?? "";
  const synopsis = decodeEntities(extractParagraphs(synBlock)).trim();

  // <a href="https://centralnovel.com/<slug>-capitulo-1/"><span>...First Chapter...</span>
  // The live site is Portuguese, so the label may be "Primeiro Capítulo"
  // rather than "First Chapter". Fall back to the chapter-1 URL pattern.
  const firstRaw =
    safeMatch(
      html,
      /<a href="([^"]+)">(?:(?!<\/a>)[\s\S])*?(?:First Chapter|Primeiro Cap[ií]tulo)/i,
    ) ??
    safeMatch(html, /href="(https:\/\/centralnovel\.com\/[^"]*-capitulo-1\/)"/i);
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: centralnovel"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseCentralNovelChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <h1 class="entry-title" itemprop="headline">Reverend\nInsanity – Capítulo 1</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "";

  // <div class="epcontent entry-content" ...> ... <p>paragraphs</p> ... </div>
  const contentBlock =
    extractByDepth(html, 'class="epcontent entry-content"') ?? "";
  const content = extractParagraphs(contentBlock);

  // <a aria-label="next" href="https://centralnovel.com/<slug>-capitulo-2/" rel="next">
  const nextRaw = safeMatch(html, /<a[^>]*href="([^"]+)"[^>]*rel="next"/i);
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const centralNovelScraper: SourceScraper = {
  id: "centralnovel",
  name: "CentralNovel",

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
    return parseCentralNovelMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseCentralNovelChapter(html, url);
  },
};
