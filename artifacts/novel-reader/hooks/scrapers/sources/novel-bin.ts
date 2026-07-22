import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

const BASE_HOST = "novel-bin.com";

/**
 * novel-bin.com doesn't wrap synopsis text in <p> tags — it's raw text
 * nodes separated by bare <br> tags inside div.desc-text. Split on <br>,
 * strip/decode each fragment, drop empties, join with double newlines.
 */
const extractBrSeparatedText = (html: string): string => {
  return html
    .split(/<br\s*\/?>/gi)
    .map((chunk) => decodeEntities(stripTags(chunk)))
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Chapter content on this site is NOT wrapped in individual <p> tags —
 * div#chr-content starts with a leading empty <p></p>, then an <h4>
 * restating the chapter title, then the real body as raw text nodes
 * separated by bare <br> tags. Pulling <p>...</p> matches (extractParagraphs,
 * the previous approach here) only ever finds that one empty <p></p> and
 * returns nothing — this is the same <br>-separated style as the synopsis,
 * so reuse that same splitting approach instead, after stripping the
 * leading <h4> title repeat.
 *
 * Exported for the scraper content-extraction regression test — see
 * scripts/test-scrapers.ts.
 */
export const extractChapterBody = (rawContentBlock: string): string => {
  const contentBlock = rawContentBlock.replace(/<h4[^>]*>[\s\S]*?<\/h4>/i, "");
  return extractBrSeparatedText(contentBlock);
};

export const novelBinScraper: SourceScraper = {
  id: "novelbin",
  name: "Novel-Bin",

  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.includes(BASE_HOST);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    // <meta itemprop="image" content="https://novel-bin.com/files/image/....jpg">
    const coverUrl =
      safeMatch(html, /<meta[^>]*itemprop="image"[^>]*content="([^"]+)"/i) ??
      "";

    // <h3 class="title" itemprop="name">Title</h3> (inside div.desc > div.books)
    const title = decodeEntities(
      safeMatch(
        html,
        /<h3[^>]*class="title"[^>]*itemprop="name"[^>]*>([^<]+)<\/h3>/i,
      ) ?? "Unknown Title",
    );

    // <span itemprop="author" ...><meta itemprop="name" content="Author Name"></span>
    const author = decodeEntities(
      safeMatch(
        html,
        /<span[^>]*itemprop="author"[\s\S]*?<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i,
      ) ?? "Unknown Author",
    );

    // div.desc-text (itemprop="description") — plain text separated by bare <br> tags.
    // NOTE: match on class="desc-text" specifically, not the bare
    // itemprop="description" string — that also appears twice earlier in
    // unrelated <meta name="description" ...> tags in <head>, and matching
    // those would make extractByDepth's <div>/</div> counter run wild over
    // the rest of the page.
    const descBlock = extractByDepth(html, 'class="desc-text"') ?? "";
    const synopsis = extractBrSeparatedText(descBlock);

    // <a class="btn btn-danger btn-read-now" title="READ NOW" href="/novel-bin/{slug}/chapter-1">
    const firstChapterPath = safeMatch(
      html,
      /<a[^>]*class="btn btn-danger btn-read-now"[^>]*href="([^"]+)"/i,
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

    // <h2><a class="chr-title" ... title="Chapter 1: Damn system!"><span class="chr-text">...</span></a></h2>
    const title = decodeEntities(
      safeMatch(html, /<a[^>]*class="chr-title"[^>]*title="([^"]+)"/i) ?? "",
    );

    // <div id="chr-content" class="chr-c" ...>...</div>
    const contentBlock = extractByDepth(html, 'id="chr-content"') ?? "";
    const content = extractChapterBody(contentBlock);

    // <a title="Chapter 2: ..." href="..." class="btn btn-success" id="next_chap">
    // Gets a `disabled=""` attribute (no href change) on the last chapter.
    // Note: safeMatch() returns capture group 1, so it can't be used to
    // grab the whole tag with no group — use a plain match for that.
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
