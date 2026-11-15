// hooks/scrapers/sources/lightnovelto.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";
import { extractParagraphs } from "./novelphoenix";

const BASE_HOST = "lightnovel.to";

/**
 * Pure parser for the novel info page. No network: takes the page HTML and
 * its URL, returns the metadata. Exported so scripts/test-scrapers.ts can
 * exercise it against fixture HTML.
 */
export const parseLightNovelToMeta = (html: string, url: string): NovelMeta => {
  // <h1 class="ln-dtitle ...">Title</h1>
  const title = decodeEntities(
    safeMatch(html, /<h1[^>]*class="ln-dtitle[^"]*"[^>]*>([^<]+)<\/h1>/i) ??
      "Unknown Title",
  );

  // <a class="ln-v" href="/author/...">Author</a>
  const author = decodeEntities(
    safeMatch(
      html,
      /<a[^>]*class="ln-v"[^>]*href="\/author\/[^"]*"[^>]*>([^<]+)<\/a>/i,
    ) ?? "Unknown Author",
  );

  // <div class="ln-dcv"><img src="...">
  const coverUrl =
    safeMatch(
      html,
      /<div[^>]*class="ln-dcv"[^>]*>\s*<img[^>]*src="([^"]+)"/i,
    ) ?? "";

  // <div class="ln-synwrap"><div class="ln-syn" ...><p>paragraphs</p></div></div>
  // The closing quote matters: a bare 'class="ln-syn' prefix is ambiguous.
  const synBlock = extractByDepth(html, 'class="ln-synwrap"') ?? "";
  const synopsis = extractParagraphs(synBlock);

  // <a class="ln-sb ln-pri" href="/novel/<slug>/chapter-1">Start Chapter 1
  const firstRaw = safeMatch(
    html,
    /<a[^>]*class="ln-sb ln-pri"[^>]*href="([^"]+)"/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: lightnovelto"],
  };
};

/**
 * Pure parser for a chapter page. No network. Returns the title, the
 * paragraph text, and the next-chapter URL (null on the last chapter, where
 * the next link is marked aria-disabled="true").
 */
export const parseLightNovelToChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <h1 class="text-balance ...">Chapter 1 - Prologue</h1>
  const title = decodeEntities(
    safeMatch(html, /<h1[^>]*class="text-balance[^"]*"[^>]*>([^<]+)<\/h1>/i) ??
      "",
  );

  // <div class="ln-prose" ...><p>...</p><p>...</p></div>
  const proseBlock = extractByDepth(html, 'class="ln-prose') ?? "";
  const content = extractParagraphs(proseBlock);

  // <a class="ln-chapnav-side ln-chapnav-next" href="/novel/.../chapter-2">
  const nextTag = html.match(/<a\b[^>]*ln-chapnav-next[^>]*>/i)?.[0] ?? "";
  const nextDisabled = /aria-disabled="true"/i.test(nextTag);
  const nextRaw = safeMatch(nextTag, /href="([^"]+)"/i);
  const nextUrl =
    !nextDisabled && nextRaw && isSafeHref(nextRaw)
      ? makeAbsoluteUrl(nextRaw, url)
      : null;

  return { url, title, content, nextUrl };
};

export const lightNovelToScraper: SourceScraper = {
  id: "lightnovelto",
  name: "LightNovelTo",

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
    return parseLightNovelToMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseLightNovelToChapter(html, url);
  },
};
