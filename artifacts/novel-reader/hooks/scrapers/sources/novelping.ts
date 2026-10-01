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
 * Chapter-body paragraphs. Confirmed against a real chapter page: each line
 * is its own <p>, many with a trailing "\n" before </p>, plus empty <p></p>
 * tags. Trim every paragraph and drop the empties so the "\n\n" join stays clean.
 */
const extractChapterParagraphs = (html: string): string => {
  return [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeEntities(stripTags(m[1].replace(/<br\s*\/?>/gi, "\n")))
        .replace(/\u00a0/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Fallback for the sibling-template's bare-<br> paragraph style, in case a
 * chapter page ever turns out to use it instead of real <p> tags. The
 * confirmed chapter template uses <p>, so this is just a safety net.
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
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // CONFIRMED against a real chapter page:
    // <a class="chr-title" ... title="Chapter 1. ..."><span class="chr-text">
    const title = decodeEntities(
      safeMatch(html, /<a[^>]*class="chr-title"[^>]*title="([^"]+)"/i) ??
        safeMatch(
          html,
          /<span[^>]*class="chr-text"[^>]*>\s*([^<]+?)\s*<\/span>/i,
        ) ??
        `Chapter ${chapterNum}`,
    ).trim();

    // CONFIRMED: <div id="chr-content" class="chr-c"> holding one <p> per line,
    // with js-ad-slot divs at the top and bottom. Strip scripts and ad slots
    // first so nothing injected there leaks into the chapter text.
    const contentBlock = (extractByDepth(html, 'id="chr-content"') ?? "")
      .replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<div[^>]*js-ad-slot[^>]*>[\s\S]*?<\/div>/gi, "");

    const content =
      extractChapterParagraphs(contentBlock) ||
      extractBrSeparatedText(contentBlock);

    // Fail loudly instead of saving a blank chapter (selector miss,
    // Cloudflare challenge page, etc).
    if (!content) {
      throw new Error(`novelping: empty chapter content for ${url}`);
    }

    // CONFIRMED on chapter 1: next button is
    // <a class="... js-chapter-nav" data-chapter-nav="next" ... href="...">.
    // The prev button on chapter 1 shows the disabled form: disabled="",
    // empty data-chapter-url, href="javascript:void(0)". Assumed the next
    // button looks the same on the last chapter (NOT yet seen).
    const nextTag =
      html.match(/<a\b[^>]*data-chapter-nav="next"[^>]*>/i)?.[0] ?? "";
    const nextHref = safeMatch(nextTag, /\shref="([^"]*)"/i);
    const isDisabled = /\sdisabled(?:=|\s|\/|>)/i.test(nextTag);
    const nextUrl =
      nextHref && !isDisabled && !/^(javascript:|#)/i.test(nextHref)
        ? makeAbsoluteUrl(decodeEntities(nextHref), url)
        : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
