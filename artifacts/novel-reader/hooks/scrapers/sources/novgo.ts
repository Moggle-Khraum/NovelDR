// hooks/scrapers/sources/novgo.ts
// NovGo (novgo.net), WordPress-style "fwn" layout.
// Novel:   /<slug>.html
// Chapter: /<slug>/chapter-<n>-<title>.html
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "novgo.net";

// Site text that can appear inside the chapter block.
const CHAPTER_JUNK: RegExp[] = [
  /novgo\.net/i,
  /novelfull\.com/i,
  /readnovelfull\.com/i,
  /allnovel\.org/i,
];
const isJunk = (text: string): boolean =>
  CHAPTER_JUNK.some((re) => re.test(text));

// The summary box on novel pages holds generic SEO text, not a real synopsis.
const isSeoBoilerplate = (text: string): boolean =>
  /novel online free|novel pdf free download|explore .* on novgo/i.test(text);

/**
 * Only the text inside #chapter-content is the chapter. Scanning the whole
 * page would also pick up the tips line, comment rules and login text.
 */
const chapterParagraphs = (html: string): string[] => {
  const block = safeMatch(
    html,
    /<div id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!block) return [];
  return [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeEntities(stripTags(m[1]))
        .replace(/\u00a0/g, " ")
        .trim(),
    )
    .filter((t) => t.length > 0 && !isJunk(t));
};

/**
 * Chapter headings look like "C1: Meeting an Online Girlfriend in Real Life?"
 * or "C30 - 29: A Clear Heartbeat". Keep only the title, and number it with
 * the app's chapter number.
 */
const cleanChapterTitle = (raw: string, chapterNum: number): string => {
  const rest = raw
    .replace(/^C\d+(\s*-\s*\d+)?\s*[:.\-–—]?\s*/i, "")
    .replace(/^Chapter\s+\d+(\s*-\s*\d+)?\s*[:.\-–—]?\s*/i, "")
    .trim();
  return rest ? `Chapter ${chapterNum}: ${rest}` : `Chapter ${chapterNum}`;
};

/** True when the URL points at a chapter page on this site. */
const isChapterUrl = (url: string | null): boolean => {
  if (!url) return false;
  try {
    return /\/chapter-\d+[^/]*\.html$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

export const novgoScraper: SourceScraper = {
  id: "novgo",
  name: "NovGo",

  canHandle: (url: string) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === BASE_HOST || hostname.endsWith(`.${BASE_HOST}`);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    // <div class="m-desc"><h1 class="tit">Title</h1>
    const title = decodeEntities(
      safeMatch(html, /<h1 class="tit">\s*([^<]+?)\s*<\/h1>/i) ??
        "Unknown Title",
    ).trim();

    // <div class="item"><span class="glyphicon glyphicon-user"...></span>
    //   <div class="right"><a href="/author/Name" ...>Name</a></div></div>
    const author = decodeEntities(
      safeMatch(
        html,
        /glyphicon-user[\s\S]{0,200}?<a[^>]*href="\/author\/[^"]*"[^>]*>([^<]+)<\/a>/i,
      ) ?? "Unknown Author",
    ).trim();

    // Summary box: <div class="inner" id="novel-summary-inner"><p>...</p></div>
    let synopsis = "No summary available.";
    const summaryBlock = safeMatch(
      html,
      /<div class="inner" id="novel-summary-inner">([\s\S]*?)<\/div>/i,
    );
    if (summaryBlock) {
      const paragraphs = [...summaryBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => decodeEntities(stripTags(m[1])).trim())
        .filter(Boolean);
      const text = paragraphs.join("\n\n");
      if (text && !isSeoBoilerplate(text)) synopsis = text;
    }

    // <div class="m-imgtxt"><div class="pic"><img src="/uploads/..." ...>
    const coverRaw =
      safeMatch(
        html,
        /<div class="m-imgtxt">\s*<div class="pic">\s*<img[^>]*src="([^"]+)"/i,
      ) ?? safeMatch(html, /<meta property="og:image" content="([^"]+)"/i);
    const coverUrl = coverRaw
      ? makeAbsoluteUrl(decodeEntities(coverRaw), url)
      : "";

    // First chapter: the page's own "read first" link, then the first list item.
    const firstRaw =
      safeMatch(html, /data-first-url="([^"]+)"/i) ??
      safeMatch(html, /<a[^>]*data-reading-first[^>]*href="([^"]+)"/i) ??
      safeMatch(html, /id="idData"[\s\S]{0,400}?<a href="([^"]+)"/i);
    const firstChapterUrl = firstRaw
      ? makeAbsoluteUrl(decodeEntities(firstRaw), url)
      : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: novgo"],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // <h1 class="chapter"><span class="chapter-text">C1: Title</span></h1>
    const headingRaw = safeMatch(
      html,
      /<h1 class="chapter">[\s\S]*?<span class="chapter-text">([^<]+)<\/span>/i,
    );
    const title = headingRaw
      ? cleanChapterTitle(
          decodeEntities(headingRaw).replace(/\s+/g, " ").trim(),
          chapterNum,
        )
      : `Chapter ${chapterNum}`;

    const paragraphs = chapterParagraphs(html);
    // The first paragraph often repeats the heading ("Chapter 1: Chapter 1 ...").
    if (
      paragraphs.length > 1 &&
      /^Chapter\s+\d+\b/i.test(paragraphs[0]) &&
      paragraphs[0].length < 150
    ) {
      paragraphs.shift();
    }
    const content = paragraphs.join("\n\n");
    if (!content) {
      throw new Error(`novgo: chapter content not found for ${url}`);
    }

    // Next link: <a href="/...-chapter-2-....html" data-nav="next" ...>
    // Accept it only if it is a different chapter page on this site.
    let nextUrl: string | null = null;
    const nextRaw =
      safeMatch(html, /<a[^>]*href="([^"]+)"[^>]*data-nav="next"/i) ??
      safeMatch(
        html,
        /<li class="reader-next-item"[\s\S]*?<a[^>]*href="([^"]+)"/i,
      );
    if (nextRaw && isSafeHref(nextRaw)) {
      const resolved = makeAbsoluteUrl(decodeEntities(nextRaw), url);
      if (isChapterUrl(resolved) && resolved !== url) nextUrl = resolved;
    }

    return { url, title, content, nextUrl };
  },
};
