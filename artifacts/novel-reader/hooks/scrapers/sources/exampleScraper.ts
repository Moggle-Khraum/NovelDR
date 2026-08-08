// TEMPLATE — copy this file for each new source (e.g. myNewSite.ts),
// then register the export in ../registry.ts.
//
// Rename `exampleScraper` and update id/name/canHandle/selectors below.

import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
  extractByDepth,
} from "../shared/html";

const BASE_HOST = "example.com"; // <-- change per source

export const exampleScraper: SourceScraper = {
  id: "example-source",
  name: "ExampleSource",

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

    // --- Replace these with real selectors for the target site ---
    const title = decodeEntities(
      safeMatch(html, /<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/i) ??
        "Unknown Title",
    );
    const author = decodeEntities(
      safeMatch(html, /<span[^>]*class="author"[^>]*>([^<]+)<\/span>/i) ??
        "Unknown Author",
    );
    const rawSynopsis = extractByDepth(html, 'class="synopsis"') ?? "";
    const synopsis = decodeEntities(stripTags(rawSynopsis));
    const coverPath = safeMatch(
      html,
      /<img[^>]*class="cover"[^>]*src="([^"]+)"/i,
    );
    const coverUrl = coverPath ? makeAbsoluteUrl(coverPath, url) : "";
    const firstChapterPath = safeMatch(
      html,
      /<a[^>]*class="first-chapter"[^>]*href="([^"]+)"/i,
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
      debugInfo: ["fetched via external scraper: example-source"],
    };
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // --- Replace these with real selectors for the target site ---
    const title = decodeEntities(
      safeMatch(html, /<h2[^>]*class="chapter-title"[^>]*>([^<]+)<\/h2>/i) ??
        "",
    );
    const rawContent = extractByDepth(html, 'class="chapter-content"') ?? "";
    const content = decodeEntities(stripTags(rawContent));
    const nextPath = safeMatch(
      html,
      /<a[^>]*class="next-chapter"[^>]*href="([^"]+)"/i,
    );
    const nextUrl = nextPath ? makeAbsoluteUrl(nextPath, url) : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
