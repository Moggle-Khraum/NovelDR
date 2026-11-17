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

/** Pairs of [url, label] from the chapter dropdown on a chapter page. */
const readChapterDropdown = (html: string): string[] => {
  // The chapter dropdown is a plain <select> (no class). Pick the select whose
  // options point at chapter pages; the font/line-height selects don't.
  for (const sel of html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/gi)) {
    const urls: string[] = [];
    for (const m of sel[1].matchAll(
      /<option[^>]*value="(https?:\/\/[^"]+)"/gi,
    )) {
      urls.push(m[1].replace(/\s+/g, ""));
    }
    if (urls.some((u) => /\/glava-/i.test(u))) return urls;
  }
  return [];
};

/** Chapter 1 is the last option of the dropdown (list is newest first). */
export const parseJaomixFirstChapter = (
  chapterPageHtml: string,
): string | null => {
  const urls = readChapterDropdown(chapterPageHtml);
  const last = urls[urls.length - 1];
  return last && isSafeHref(last) ? last : null;
};

/** The chapter above the current one in the newest-first dropdown is the next. */
const nextChapterFromDropdown = (html: string, url: string): string | null => {
  const urls = readChapterDropdown(html);
  const current = url.replace(/\s+/g, "").replace(/\/$/, "");
  const idx = urls.findIndex((u) => u.replace(/\/$/, "") === current);
  if (idx <= 0) return null;
  const next = urls[idx - 1];
  return isSafeHref(next) ? next : null;
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
      const chapterHtml = await fetchHtmlWithFallback(
        makeAbsoluteUrl(newestRaw, url),
      );
      meta.firstChapterUrl = parseJaomixFirstChapter(chapterHtml);
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
