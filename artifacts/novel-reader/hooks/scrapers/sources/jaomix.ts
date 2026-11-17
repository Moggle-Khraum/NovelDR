// hooks/scrapers/sources/jaomix.ts
// Ported from LNReader's plugins/russian/jaomix.ts (MIT, © 2021 Rajarshee
// Chatterjee) and adapted to NovelDR's pure-parser pattern. Selectors follow
// the LNReader plugin; see the TODO on nextUrl for what still needs a sample.
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

const BASE_HOST = "jaomix.ru";

/**
 * Pure parser for the novel info page. No network.
 */
export const parseJaomixMeta = (html: string, url: string): NovelMeta => {
  // <div class="desc-book"><h1>Title</h1>
  const titleRaw = safeMatch(
    html,
    /<div class="desc-book">\s*<h1[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "Unknown Title";

  // <div class="img-book"><img src="…"></div>
  const coverUrl =
    safeMatch(html, /<div class="img-book">\s*<img[^>]*src="([^"]+)"/i) ?? "";

  // <div id="info-book"><p>Автор: Name</p><p>Статус: продолжается</p>…</div>
  // Labels are Russian: "Автор:" (author), "Жанры:" (genres), "Статус:" (status).
  const infoBlock = extractByDepth(html, 'id="info-book"') ?? "";
  const authorLine = safeMatch(
    infoBlock,
    /<p[^>]*>\s*Автор:\s*([\s\S]*?)<\/p>/i,
  );
  const author = authorLine
    ? decodeEntities(stripTags(authorLine)).replace(/\s+/g, " ").trim() ||
      "Unknown Author"
    : "Unknown Author";

  // <div id="desc-tab"> … </div>
  const descBlock = extractByDepth(html, 'id="desc-tab"') ?? "";
  const synopsis = decodeEntities(extractParagraphs(descBlock)).trim();

  // The first chapter is the first entry of the chapter list on the page.
  // The list may continue on AJAX pages (admin-ajax.php), which we don't fetch
  // here; chapter 1 is always the first row.
  const firstRaw = safeMatch(
    html,
    /<div class="title">\s*<a[^>]*href="([^"]+)"/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: jaomix (ported from LNReader)"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseJaomixChapter = (html: string, url: string): ChapterData => {
  // <h1> chapter title (Jaomix shows it in the entry header)
  const titleRaw = safeMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleRaw
    ? decodeEntities(stripTags(titleRaw)).replace(/\s+/g, " ").trim()
    : "";

  // <div class="entry-content"> … <p>paragraphs</p> … </div>
  const contentBlock = extractByDepth(html, 'class="entry-content"') ?? "";
  const content = extractParagraphs(contentBlock);

  // TODO(sample needed): the next-chapter link is not in the LNReader plugin.
  // Set from a real chapter page once a sample is provided.
  const nextRaw = safeMatch(html, /<a[^>]*rel="next"[^>]*href="([^"]+)"/i);
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const jaomixScraper: SourceScraper = {
  id: "jaomix",
  name: "Jaomix",

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
    return parseJaomixMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseJaomixChapter(html, url);
  },
};
