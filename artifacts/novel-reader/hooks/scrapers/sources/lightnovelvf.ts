// hooks/scrapers/sources/lightnovelvf.ts
// Parsers for LightNovelVF (lightnovelvf.com, French). Selectors were checked
// against saved novel and chapter pages. The chapter list is loaded by
// JavaScript, so chapter 1 comes from the URL pattern and the next chapter
// from the reader's data-next-url attribute.
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

const BASE_HOST = "lightnovelvf.com";

/**
 * Pure parser for the novel page. No network.
 */
export const parseLightNovelVfMeta = (html: string, url: string): NovelMeta => {
  // <h1 … itemprop="name headline"> Title </h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*itemprop="name headline"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "Unknown Title";

  // <a … itemprop="author">   Name</a>
  const authorRaw = safeMatch(
    html,
    /<a[^>]*itemprop="author"[^>]*>([\s\S]*?)<\/a>/i,
  );
  const authorText = authorRaw
    ? decodeEntities(stripTags(authorRaw)).replace(/\s+/g, " ").trim()
    : "";
  const author = authorText || "Unknown Author";

  // <meta property="og:image" content="https://…/cover/….jpg">
  const coverUrl =
    safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ?? "";

  // <div class="lnv-synopsis__body …" itemprop="description">Text…</div>
  const synRaw = safeMatch(
    html,
    /<div[^>]*class="lnv-synopsis__body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const synopsis = synRaw
    ? decodeEntities(stripTags(synRaw)).replace(/\s+\n/g, "\n").trim()
    : "";

  // Chapter 1 is the URL ending in /1 under the novel's slug. The novel page
  // lists chapters through JavaScript, so the URL pattern is the reliable way.
  const base = url.replace(/\/+$/, "");
  const firstChapterUrl = isSafeHref(`${base}/1`) ? `${base}/1` : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: lightnovelvf"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseLightNovelVfChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <h1 class="lnv-chap-h1">Chapitre 2 — Title</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="lnv-chap-h1"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "";

  // <div class="lnv-reader-content"> … <p>paragraphs</p> … </div>
  const contentBlock = extractByDepth(html, 'class="lnv-reader-content"') ?? "";
  const content = extractParagraphs(contentBlock);

  // The reader carries the next chapter's URL. The last chapter has none.
  const nextRaw = safeMatch(html, /data-next-url="([^"]+)"/i);
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const lightNovelVfScraper: SourceScraper = {
  id: "lightnovelvf",
  name: "LightNovelVF",

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
    return parseLightNovelVfMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseLightNovelVfChapter(html, url);
  },
};
