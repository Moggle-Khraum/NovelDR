import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
  splitAdjacentDialogue,
  splitGluedSentences,
  splitInnerThoughtClose,
} from "../shared/html";

const BASE_HOST = "novel-bin.com";

/**
 * novel-bin.com doesn't wrap synopsis text in <p> tags — it's raw text
 * nodes separated by bare <br> tags. Split on <br>, strip/decode each
 * fragment, drop empties, join with double newlines.
 */
const extractBrSeparatedText = (html: string): string => {
  return html
    .split(/<br\s*\/?>/gi)
    .map((chunk) => decodeEntities(stripTags(chunk)))
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Chapter body extraction. Two markups are handled:
 *
 * - Current (2026 redesign): one <p> per paragraph. The first <p> usually
 *   repeats the chapter title, so it is dropped when it matches.
 * - Legacy: <br>-separated text with a leading <h4> title repeat.
 *
 * The same glue/dialogue fixes are applied to both, since the site's text
 * can still run sentences and dialogue together.
 *
 * Exported for the scraper content-extraction regression test — see
 * scripts/test-scrapers.ts.
 */
export const extractChapterBody = (
  rawContentBlock: string,
  chapterTitle = "",
): string => {
  const paras = [...rawContentBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter(Boolean);
  if (paras.length > 1) {
    const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
    // The first paragraph is usually the heading again, sometimes without the
    // "Chapter N:" prefix. Drop it when the heading contains it (min 15 chars,
    // so a short real first line is never dropped by accident).
    if (
      chapterTitle &&
      norm(paras[0]).length >= 15 &&
      norm(chapterTitle).includes(norm(paras[0]))
    ) {
      paras.shift();
    }
    return splitInnerThoughtClose(
      splitAdjacentDialogue(splitGluedSentences(paras.join("\n\n"))),
    );
  }

  const contentBlock = rawContentBlock.replace(/<h4[^>]*>[\s\S]*?<\/h4>/i, "");
  return splitInnerThoughtClose(
    splitAdjacentDialogue(
      splitGluedSentences(extractBrSeparatedText(contentBlock)),
    ),
  );
};

export const novelBinScraper: SourceScraper = {
  id: "novelbin",
  name: "Novel-Bin",

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

    // Cover. Current: <meta property="og:image" content="...">.
    // Legacy: <meta itemprop="image" content="...">.
    const coverUrl =
      safeMatch(html, /<meta[^>]*itemprop="image"[^>]*content="([^"]+)"/i) ??
      safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ??
      "";

    // Title. Current: <h1> inside the detail header, or og:novel:novel_name.
    // Legacy: <h3 class="title" itemprop="name">.
    const title = decodeEntities(
      safeMatch(
        html,
        /<h3[^>]*class="title"[^>]*itemprop="name"[^>]*>([^<]+)<\/h3>/i,
      ) ??
        safeMatch(
          html,
          /<div class="almanac-detail-intro"[\s\S]*?<h1>([^<]+)<\/h1>/i,
        ) ??
        safeMatch(
          html,
          /<meta[^>]*property="og:novel:novel_name"[^>]*content="([^"]+)"/i,
        ) ??
        "Unknown Title",
    );

    // Author. Current: <meta property="og:novel:author">.
    // Legacy: <span itemprop="author"><meta itemprop="name" content="...">.
    const author = decodeEntities(
      safeMatch(
        html,
        /<span[^>]*itemprop="author"[\s\S]*?<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i,
      ) ??
        safeMatch(
          html,
          /<meta[^>]*property="og:novel:author"[^>]*content="([^"]+)"/i,
        ) ??
        "Unknown Author",
    );

    // Synopsis. Current: div.almanac-synopsis. Legacy: div.desc-text.
    // Both are <br>-separated text. Match on the class, not the bare
    // itemprop, which also appears in <head> meta tags.
    const descBlock =
      extractByDepth(html, 'class="desc-text"') ??
      extractByDepth(html, 'class="almanac-synopsis"') ??
      "";
    const synopsis = splitInnerThoughtClose(
      splitAdjacentDialogue(
        splitGluedSentences(extractBrSeparatedText(descBlock)),
      ),
    );

    // First chapter. Current: a.almanac-primary-action ("Start reading").
    // Legacy: a.btn-read-now.
    const firstChapterPath =
      safeMatch(
        html,
        /<a[^>]*class="btn btn-danger btn-read-now"[^>]*href="([^"]+)"/i,
      ) ??
      safeMatch(
        html,
        /<a[^>]*href="([^"]+)"[^>]*class="almanac-primary-action"/i,
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
      debugInfo: ["fetched via external scraper: novelbin"],
    };
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // Chapter title. Current: <span class="chr-text"> inside the <h1>.
    // Legacy: <a class="chr-title" title="...">.
    const title = decodeEntities(
      safeMatch(html, /<a[^>]*class="chr-title"[^>]*title="([^"]+)"/i) ??
        safeMatch(
          html,
          /<h1[^>]*>\s*<span class="chr-text">([^<]+)<\/span>/i,
        ) ??
        "",
    );

    // Chapter body: div#chr-content.
    const contentBlock = extractByDepth(html, 'id="chr-content"') ?? "";
    const content = extractChapterBody(contentBlock, title);

    // Next chapter: a#next_chap. It has no href change and gets a
    // `disabled=""` attribute on the last chapter. Plain match on the whole
    // tag, since safeMatch() returns capture group 1 only.
    const nextTag = html.match(/<a[^>]*id="next_chap"[^>]*>/i)?.[0] ?? "";
    const nextHref = safeMatch(nextTag, /href="([^"]+)"/i);
    const isDisabled = /disabled=""/i.test(nextTag);
    const nextUrl =
      nextHref && !isDisabled ? makeAbsoluteUrl(nextHref, url) : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
