// hooks/scrapers/sources/novelbuddy.ts
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

const BASE_HOST = "novelbuddy.me";

/**
 * Pure parser for the novel info page. No network.
 */
export const parseNovelBuddyMeta = (html: string, url: string): NovelMeta => {
  // <h1 class="font-display ...">Title</h1>
  const title = decodeEntities(
    safeMatch(html, /<h1[^>]*class="font-display[^"]*"[^>]*>([^<]+)<\/h1>/i) ??
      "Unknown Title",
  );

  // <a href="/authors/...">Author</a>
  const author = decodeEntities(
    safeMatch(html, /<a[^>]*href="\/authors\/[^"]*"[^>]*>([^<]+)<\/a>/i) ??
      "Unknown Author",
  );

  // <img src="https://rs.novelbuddy.me/covers/...">
  const coverUrl =
    safeMatch(
      html,
      /<img[^>]*src="(https:\/\/rs\.novelbuddy\.me\/covers\/[^"]+)"/i,
    ) ?? "";

  // <p class="text-[14px] ... leading-relaxed ...">Synopsis</p>
  const synRaw = safeMatch(
    html,
    /<p[^>]*class="[^"]*leading-relaxed[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const synopsis = synRaw ? decodeEntities(stripTags(synRaw)).trim() : "";

  // <a href="/<slug>/chapter-1-..."> wrapping the "Start Reading" button
  const firstRaw = safeMatch(
    html,
    /<a[^>]*href="([^"]+)"[^>]*>\s*<button[^>]*>(?:(?!<\/button>)[\s\S])*?Start Reading/i,
  );
  const firstChapterUrl =
    firstRaw && isSafeHref(firstRaw) ? makeAbsoluteUrl(firstRaw, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: novelbuddy"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseNovelBuddyChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <p class="mt-1.5 ...">Chapter 1: Title</p> under the page header
  const title = decodeEntities(
    safeMatch(html, /<p[^>]*class="mt-1\.5[^"]*"[^>]*>([^<]+)<\/p>/i) ?? "",
  );

  // <div class="novel-tts-content ..."> ... <p>paragraphs</p> ... </div>
  const contentBlock = extractByDepth(html, 'class="novel-tts-content') ?? "";
  const content = extractParagraphs(contentBlock);

  // Reader pager: <a ... aria-label="Next chapter" href="...">.
  // Missing on the last chapter.
  const nextRaw = safeMatch(
    html,
    /aria-label="Next chapter"[^>]*href="([^"]+)"/i,
  );
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return { url, title, content, nextUrl };
};

export const novelBuddyScraper: SourceScraper = {
  id: "novelbuddy",
  name: "NovelBuddy",

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
    return parseNovelBuddyMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseNovelBuddyChapter(html, url);
  },
};
