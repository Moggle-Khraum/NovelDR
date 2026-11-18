// hooks/scrapers/sources/webnovelvn.ts
// Parsers for Webnovel.vn (webnovel.vn, Vietnamese). Selectors were checked
// against a saved novel page and chapter page. The site is behind Cloudflare,
// so fetches use the WebView fallback (see webviewSites.ts).
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "webnovel.vn";

/** Text from a block where lines are separated by <br>, not <p>. */
const brTextToLines = (block: string): string =>
  decodeEntities(
    block
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/[<>]/g, "")
      .replace(/[ \t]+/g, " "),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

/**
 * Pure parser for the novel page. No network.
 */
export const parseWebnovelVnMeta = (html: string, url: string): NovelMeta => {
  // <h1 id="book-detail-title" class="book-detail__title">Title</h1>
  const titleRaw = safeMatch(
    html,
    /<h1[^>]*id="book-detail-title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleRaw ? decodeEntities(titleRaw).trim() : "Unknown Title";

  // <p class="book-detail__author …"><span …></span><a href="/tac-gia/…">Name</a></p>
  const authorRaw = safeMatch(
    html,
    /<p[^>]*class="book-detail__author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
  );
  const author = authorRaw
    ? decodeEntities(authorRaw).trim()
    : "Unknown Author";

  // <meta property="og:image" content="https://cdn.webnovel.vn/…">
  const coverUrl =
    safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ?? "";

  // <div class="book-detail__summary">Nhóm dịch: …<br><br>Văn án:…</div>
  const summaryBlock =
    extractByDepth(html, 'class="book-detail__summary"') ?? "";
  const synopsis = brTextToLines(summaryBlock);

  // Chapter 1 follows the site's /chuong-N/ pattern under the novel's slug.
  const base = url.replace(/\/+$/, "");
  const firstChapterUrl = isSafeHref(`${base}/chuong-1/`)
    ? `${base}/chuong-1/`
    : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: webnovel.vn"],
  };
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseWebnovelVnChapter = (
  html: string,
  url: string,
): ChapterData => {
  // <title>Chương 1 - Novel Title | Webnovel.vn</title>; the chapter label is
  // the part before the first " - ".
  const pageTitle = safeMatch(html, /<title>([\s\S]*?)<\/title>/i) ?? "";
  const title = decodeEntities(pageTitle).split(" - ")[0].trim();

  // <div id="chapter-c">line<br><br>line…</div>
  const contentBlock = extractByDepth(html, 'id="chapter-c"') ?? "";
  const content = brTextToLines(contentBlock);

  // <link rel="next" href="…/chuong-2/">
  const nextRaw = safeMatch(html, /<link rel="next" href="([^"]+)"/i);
  const nextUrl =
    nextRaw && isSafeHref(nextRaw) ? makeAbsoluteUrl(nextRaw, url) : null;

  return {
    url,
    title,
    content,
    nextUrl,
  };
};

export const webnovelVnScraper: SourceScraper = {
  id: "webnovelvn",
  name: "Webnovel.vn",

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
    return parseWebnovelVnMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseWebnovelVnChapter(html, url);
  },
};
