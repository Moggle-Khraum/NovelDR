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

type DropdownChapter = { url: string; num: number | null };

/**
 * Chapter links from the chapter dropdown on a chapter page, with the chapter
 * number taken from the label ("Глава 12: …"). The dropdown only covers part
 * of the novel and its order is not fixed, so callers use the numbers.
 */
const readChapterDropdown = (html: string): DropdownChapter[] => {
  // The chapter dropdown is a plain <select> (no class). Pick the select whose
  // options point at chapter pages; the font/line-height selects don't.
  for (const sel of html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/gi)) {
    const chapters: DropdownChapter[] = [];
    for (const m of sel[1].matchAll(
      /<option[^>]*value="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/option>/gi,
    )) {
      const url = m[1].replace(/\s+/g, "");
      const numMatch = m[2].match(/(\d+)/);
      chapters.push({ url, num: numMatch ? Number(numMatch[1]) : null });
    }
    if (chapters.some((c) => /\/glava-/i.test(c.url))) return chapters;
  }
  return [];
};

/** The dropdown entry with the lowest chapter number on this page, if any. */
const lowestChapterOnPage = (html: string): DropdownChapter | null => {
  const numbered = readChapterDropdown(html).filter((c) => c.num !== null);
  if (numbered.length === 0) return null;
  return numbered.reduce((a, b) => (b.num! < a.num! ? b : a));
};

/**
 * Walks back through the chapter pages (each dropdown only covers part of the
 * novel) until the page whose dropdown reaches chapter 1. Caller passes a
 * fetcher so this stays free of network code in the pure parser.
 */
export const findJaomixFirstChapter = async (
  newestChapterUrl: string,
  fetchPage: (url: string) => Promise<string>,
  maxSteps = 60,
): Promise<string | null> => {
  let current = newestChapterUrl;
  for (let step = 0; step < maxSteps; step++) {
    const html = await fetchPage(current);
    const low = lowestChapterOnPage(html);
    if (!low) return null;
    if (low.num! <= 1) return low.url;
    if (low.url === current) return null;
    current = low.url;
  }
  return null;
};

/** The chapter after the current one: the dropdown entry numbered one higher. */
const nextChapterFromDropdown = (html: string, url: string): string | null => {
  const chapters = readChapterDropdown(html);
  const current = url.replace(/\s+/g, "").replace(/\/$/, "");
  const self = chapters.find((c) => c.url.replace(/\/$/, "") === current);
  if (!self) return null;
  let next: DropdownChapter | undefined;
  if (self.num !== null) {
    next = chapters.find((c) => c.num === self.num! + 1);
  }
  if (!next) {
    // Fallback: the dropdown lists newest first, so the entry above is next.
    const idx = chapters.indexOf(self);
    next = idx > 0 ? chapters[idx - 1] : undefined;
  }
  return next && isSafeHref(next.url) ? next.url : null;
};

/** Chapter 1 from a chapter page's dropdown, if that page reaches it. */
export const parseJaomixFirstChapter = (chapterPageHtml: string): string | null => {
  const low = lowestChapterOnPage(chapterPageHtml);
  return low && low.num === 1 && isSafeHref(low.url) ? low.url : null;
};

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
  // <div class="img-book"><div class="img-book-back" style="…"></div><img src="…">
  const coverUrl =
    safeMatch(html, /<div class="img-book"[\s\S]*?<img[^>]*src="([^"]+)"/i) ??
    "";

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

  // Chapter 1 is not on the novel page (it lists the newest chapters only), so
  // firstChapterUrl is filled in by fetchNovelMeta from a chapter page's dropdown.
  const firstChapterUrl: string | null = null;

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
  // <div class="entry-content entry"> … <p>paragraphs</p> … </div>
  const contentBlock = extractByDepth(html, 'class="entry-content') ?? "";
  const content = extractParagraphs(contentBlock);

  // The chapter dropdown lists every chapter, newest first, so the next chapter
  // is the option just above the current one.
  const nextUrl = nextChapterFromDropdown(html, url);

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
    const meta = parseJaomixMeta(html, url);
    // Open the newest chapter once to read the full dropdown and get chapter 1.
    const newestRaw = safeMatch(
      html,
      /<div class="title">\s*<a[^>]*href="([^"]+)"/i,
    );
    if (newestRaw && isSafeHref(newestRaw)) {
      meta.firstChapterUrl = await findJaomixFirstChapter(
        makeAbsoluteUrl(newestRaw, url),
        (u) => fetchHtmlWithFallback(u),
      );
    }
    return meta;
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseJaomixChapter(html, url);
  },
};
