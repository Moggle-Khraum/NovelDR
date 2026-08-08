import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

const BASE_HOST = "novelphoenix.com";

/**
 * Extract all <p>...</p> paragraphs from a block of HTML, stripped and
 * entity-decoded, joined with double newlines. Used for the synopsis,
 * which on this site is a series of <p> tags inside div.summary > div.content.
 */
export const extractParagraphs = (html: string): string => {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter(Boolean)
    .join("\n\n");
};

export const novelPhoenixScraper: SourceScraper = {
  id: "novelphoenix",
  name: "NovelPhoenix",

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

    // <img src="..." alt="..."> inside div.glass-background
    const coverUrl =
      safeMatch(
        html,
        /<div[^>]*class="glass-background"[^>]*>\s*<img[^>]*src="([^"]+)"/i,
      ) ?? "";

    // <h1 class="novel-title ...">Title</h1>
    const title = decodeEntities(
      safeMatch(html, /<h1[^>]*class="novel-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ??
        "Unknown Title",
    );

    // <div class="author">...<span itemprop="author">Name</span>...</div>
    const author = decodeEntities(
      safeMatch(
        html,
        /<div[^>]*class="author"[^>]*>[\s\S]*?<span itemprop="author">([^<]+)<\/span>/i,
      ) ?? "Unknown Author",
    );

    // div.summary > div.content > <p> paragraphs
    const summaryBlock = extractByDepth(html, 'class="summary"') ?? "";
    const contentBlock =
      extractByDepth(summaryBlock, 'class="content') ?? summaryBlock;
    const synopsis = extractParagraphs(contentBlock);

    // <a ... href="/novel/{slug}/chapter-1" ...>Read Now</a>
    const firstChapterPath = safeMatch(
      html,
      /<a[^>]*href="([^"]+)"[^>]*>Read Now<\/a>/i,
    );
    const firstChapterUrl = firstChapterPath
      ? makeAbsoluteUrl(firstChapterPath, url)
      : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: novelphoenix"],
    };
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // <span class="chapter-title">CHAPTER N — TITLE</span>
    const title = decodeEntities(
      safeMatch(
        html,
        /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i,
      ) ?? "",
    );

    // <div id="content" class="clearfix font_default" ...>...</div>
    // Contains an <h2>/<h1> restating the book/chapter title before the
    // real paragraphs, so we pull only the <p> tags rather than the whole block.
    const contentBlock = extractByDepth(html, 'id="content"') ?? "";
    const content = extractParagraphs(contentBlock);

    // <a rel="next" class="chnav next" href="...">  (href is "javascript:;" when disabled/last chapter)
    const nextRaw = safeMatch(html, /<a[^>]*rel="next"[^>]*href="([^"]+)"/i);
    const nextUrl =
      nextRaw && !nextRaw.startsWith("javascript")
        ? makeAbsoluteUrl(nextRaw, url)
        : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
