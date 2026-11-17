// hooks/scrapers/sources/ranovel.ts
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

const BASE_HOST = "ranovel.com";

// The site shows a maintenance notice inside HTML comments. Drop comments so
// the paragraph extractor never picks up hidden markup.
const stripComments = (html: string): string =>
  html.replace(/<!--[\s\S]*?-->/g, "");

// The site injects its own watermark lines and decorative separators into
// paragraphs ("Only Ran(o)vel dot com…", "* * * * *"). Drop those lines.
const WATERMARK = /ran\(o\)vel|ranovel\s*dot\s*com|read korean novel/i;
const isNoise = (line: string): boolean =>
  WATERMARK.test(line) || /^[\s*]*$/.test(line);
const dropNoise = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !isNoise(line))
    .join("\n");

/**
 * Pure parser for the novel info page (Madara theme). No network.
 */
export const parseRaNovelMeta = (html: string, url: string): NovelMeta => {
  // <div class="post-title"><h1> Title </h1></div>
  const titleRaw = safeMatch(
    html,
    /<div class="post-title">\s*<h1>\s*([^<]+?)\s*<\/h1>/i,
  );
  const title = titleRaw ? decodeEntities(titleRaw).trim() : "Unknown Title";

  // <div class="author-content"><a href="...">Name</ a></div>
  // The live site writes "</ a>" with a space, so allow whitespace before "a".
  const authorRaw = safeMatch(
    html,
    /<div class="author-content">\s*<a[^>]*>([\s\S]*?)<\/\s*a>/i,
  );
  const authorText = authorRaw
    ? decodeEntities(authorRaw.replace(/<[^>]+>/g, "")).trim()
    : "";
  const author = authorText || "Unknown Author";

  // <meta property="og:image" content="...">
  const coverUrl =
    safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ?? "";

  // <div class="summary__content "> <p>...</p> </div>
  const synBlock = extractByDepth(html, 'class="summary__content') ?? "";
  const synopsis = dropNoise(
    decodeEntities(extractParagraphs(stripComments(synBlock))),
  ).trim();

  // The "Read First" button is a placeholder (href="#") and the chapter list
  // loads by AJAX, so build chapter 1 from the novel URL. Madara slugs are
  // predictable: <novel>/chapter-1/.
  const base = url.endsWith("/") ? url : `${url}/`;
  const firstChapterUrl = isSafeHref(`${base}chapter-1/`)
    ? `${base}chapter-1/`
    : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: ranovel"],
  };
};

/**
 * Pure parser for a chapter page (Madara theme). No network.
 */
export const parseRaNovelChapter = (html: string, url: string): ChapterData => {
  // <h1 id="chapter-heading">Novel - Chapter 1</h1>
  const titleRaw = safeMatch(
    html,
    /<h1 id="chapter-heading">\s*([^<]+?)\s*<\/h1>/i,
  );
  const title = titleRaw ? decodeEntities(titleRaw).trim() : "";

  // <div class="reading-content"> … <p>paragraphs</p> … </div>
  const contentBlock = extractByDepth(html, 'class="reading-content"') ?? "";
  const content = dropNoise(extractParagraphs(stripComments(contentBlock)));

  // <a href="…/chapter-2/" class="btn next_page" title="Chapter 2">Next</a>
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

export const raNovelScraper: SourceScraper = {
  id: "ranovel",
  name: "RaNovel",

  canHandle: (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === BASE_HOST || host.endsWith(`.${BASE_HOST}`);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url, { webviewFirst: true });
    return parseRaNovelMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url, { webviewFirst: true });
    return parseRaNovelChapter(html, url);
  },
};
