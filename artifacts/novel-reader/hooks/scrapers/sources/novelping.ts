import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

// novelping.com — same template family as novel-bin.com / novelbin.cc
// (identical title/author/cover meta markup, same "desc-text" novel-detail
// layout, same comment-box-novelbin component), but NOT a byte-identical
// clone: confirmed against a real /book/ page dump that its synopsis is
// wrapped in genuine <p> tags rather than the bare <br>-separated text
// those two sibling sites use, and it exposes firstChapterUrl directly via
// an og:novel:read_url meta tag instead of needing a "READ NOW" button
// scrape. Kept as its own file (not merged into novel-bin.ts) for the same
// reason novelbincc.ts is separate: unrelated domains that happen to share
// a CMS lineage today shouldn't drag each other down if one changes later.
const BASE_HOST = "novelping.com";

/** Extract every <p>...</p> from a block of HTML */
const extractParagraphs = (html: string): string => {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Fallback for the sibling-template's bare-<br> paragraph style, in case a
 * given page (chapter pages in particular — unconfirmed, see fetchChapter)
 * turns out to use it instead of real <p> tags like the synopsis does.
 */
const extractBrSeparatedText = (html: string): string => {
  return html
    .split(/<br\s*\/?>/gi)
    .map((chunk) => decodeEntities(stripTags(chunk)))
    .filter(Boolean)
    .join("\n\n");
};

export const novelPingScraper: SourceScraper = {
  id: "novelping",
  name: "NovelPing",

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

    // <meta itemprop="image" content="https://images.novelping.com/novel/....jpg">
    const coverUrl =
      safeMatch(html, /<meta[^>]*itemprop="image"[^>]*content="([^"]+)"/i) ??
      "";

    // <div class="desc-text ..." id="novel-description-content" itemprop="description">
    //   <p>...</p><p>...</p>...
    // </div>
    // Matched on the id specifically (unique per page), not the bare
    // itemprop="description" string, which also appears in unrelated
    // <meta name="description" ...> tags in <head> and would make
    // extractByDepth's <div>/</div> counter run wild over the rest of the page.
    const descBlock = extractByDepth(html, 'id="novel-description-content"');
    const synopsis = descBlock ? extractParagraphs(descBlock) : "";

    // <meta property="og:novel:read_url" content="https://novelping.com/book/{slug}/chapter-1-...">
    // Already absolute — no makeAbsoluteUrl needed, but applied for safety
    // in case a future markup change makes it relative.
    const firstChapterPath = safeMatch(
      html,
      /<meta[^>]*property="og:novel:read_url"[^>]*content="([^"]+)"/i,
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
      debugInfo: ["fetched via external scraper: novelping"],
    };
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // UNVERIFIED — no real /book/{slug}/chapter-N page dump seen yet.
    // novel-bin.com and novelbin.cc (same template family) use
    // <a class="chr-title" title="..."> for the chapter title,
    // <div id="chr-content" class="chr-c"> for the body, and
    // <a id="next_chap" href="..."> (gets disabled="" with no href change
    // on the last chapter) for next-chapter navigation. Using those same
    // selectors here on the strength of the shared CMS lineage confirmed
    // on the novel page — but this has NOT been checked against a real
    // chapter page, unlike every other line in this file. Flag to confirm
    // with a chapter page dump; fix immediately if wrong.
    const title = decodeEntities(
      safeMatch(html, /<a[^>]*class="chr-title"[^>]*title="([^"]+)"/i) ?? "",
    );

    const contentBlock = extractByDepth(html, 'id="chr-content"') ?? "";
    const contentBlockNoHeading = contentBlock.replace(
      /<h4[^>]*>[\s\S]*?<\/h4>/i,
      "",
    );
    // Try real <p> tags first — confirmed as this site's actual style on
    // the novel page's synopsis, unlike novel-bin.com/novelbin.cc's bare
    // <br> text. Fall back to <br>-splitting only if no <p> tags are found,
    // in case the chapter template differs from the novel-detail template.
    const content =
      extractParagraphs(contentBlockNoHeading) ||
      extractBrSeparatedText(contentBlockNoHeading);

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
