// hooks/scrapers/sources/lightnovelworldnet.ts
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

const BASE_HOST = "lightnovelworld.net";

/**
 * Pure parser for the novel page (Rank Math / WordPress theme). No network.
 */
export const parseLightNovelWorldNetMeta = (
  html: string,
  url: string,
): NovelMeta => {
  // <h1 class="entry-title" itemprop="name">Title</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*class="entry-title"[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "Unknown Title";

  // <div class="serl"><span class="sername">Author</span><span class="serval">
  //   <a href="..." rel="tag">Name</a>, <a ...>Other name</a></span></div>
  const authorBlock =
    safeMatch(
      html,
      /<span class="sername">Author<\/span>\s*<span class="serval">([\s\S]*?)<\/span>/i,
    ) ?? "";
  const authorNames = [
    ...authorBlock.matchAll(/<a[^>]*rel="tag"[^>]*>([\s\S]*?)<\/a>/gi),
  ]
    .map((m) => decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const author = authorNames.length > 0 ? authorNames.join(", ") : "Unknown Author";

  // <meta property="og:image" content="...webp">
  const coverUrl =
    safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ?? "";

  // <div class="sersys entry-content" itemprop="description"> <p>...</p> </div>
  const synBlock =
    extractByDepth(html, 'class="sersys entry-content"') ?? "";
  const synopsis = decodeEntities(extractParagraphs(synBlock)).trim();

  // <a href="https://lightnovelworld.net/<slug>-chapter-1/"><span>First Chapter</span>
  const firstRaw = safeMatch(
    html,
    /<a href="([^"]+)">\s*<span>First Chapter<\/span>/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: lightnovelworldnet"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseLightNovelWorldNetChapter = (
  html: string,
  url: string,
): ChapterData => {
  // Chapter heading: <h3>Chapter 1 – 1 I’ve Long Since Wanted to Die!</h3>
  const titleRaw = safeMatch(
    html,
    /<div class="epcontent entry-content"[\s\S]*?<h3>([\s\S]*?)<\/h3>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "";

  // <div class="novel-content"> <p class="chapter-paragraph">...</p> ... </div>
  // Only the chapter-paragraph block is used, so the site's promo lines
  // outside it are skipped.
  const contentBlock = extractByDepth(html, 'class="novel-content"') ?? "";
  const content = extractParagraphs(contentBlock);

  // <a aria-label="next" href="..." rel="next">Next</a> (absent on the last chapter)
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

export const lightNovelWorldNetScraper: SourceScraper = {
  id: "lightnovelworldnet",
  name: "LightNovelWorldNet",

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
    return parseLightNovelWorldNetMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseLightNovelWorldNetChapter(html, url);
  },
};
