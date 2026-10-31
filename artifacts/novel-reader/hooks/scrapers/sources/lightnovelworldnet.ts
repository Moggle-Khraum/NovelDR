import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

// lightnovelworld.net — WordPress site (theme "lightnovel", Rank Math SEO).
// Not the same site as lightnovelworld.org, which is shut down and was
// removed from the direct scraper.
// Confirmed against real page dumps (novel page + chapter 1):
//   novel:   /novel/{slug}/
//                e.g. /novel/stop-hypnotizing-me-villainous-princess/
//   chapter: /{slug}-chapter-{n}/
//                e.g. /stop-hypnotizing-me-villainous-princess-chapter-1/
const BASE_HOST = "lightnovelworld.net";

// Site boilerplate that can appear inside chapter text blocks.
const JUNK_PATTERNS: RegExp[] = [
  /lightnovelworld\.net presents/i,
  /thank you for reading this chapter/i,
  /join the discussion/i,
];

const isJunk = (text: string): boolean =>
  JUNK_PATTERNS.some((re) => re.test(text));

/**
 * Cloudflare interstitial pages. Real pages carry passive challenge
 * scripts, so only the interstitial markers count as a block.
 */
const looksLikeChallengePage = (html: string): boolean =>
  /<title>\s*Just a moment\.\.\.\s*<\/title>|_cf_chl_opt|cf-turnstile|Verify you are human|Attention Required/i.test(
    html,
  );

/** One trimmed string per <p>, boilerplate and empties dropped. */
const paragraphsFrom = (block: string): string[] =>
  [...block.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeEntities(stripTags(m[1])).replace(/\u00a0/g, " ").trim(),
    )
    .filter((t) => t.length > 0 && !isJunk(t));

/**
 * Chapter headings look like "Chapter 1 - 1 I've Long Since Wanted to Die!",
 * "Chapter 22 - 22 I Want to * You", "Chapter 37: Racking Up Points" or
 * "Chapter 42 Lynn, the Imperial Princess...". Keep only the real title.
 * The trailing number is removed only when it matches this chapter's number,
 * so a title like "Chapter 5: 2024 Festival" keeps its "2024".
 */
const cleanChapterTitle = (raw: string, chapterNum: number): string => {
  const rest = raw
    .replace(/^Chapter\s+\d+\s*[:.\-–—]?\s*/i, "")
    .replace(new RegExp(`^[-–—]?\\s*${chapterNum}\\s+`), "")
    .trim();
  return rest ? `Chapter ${chapterNum}: ${rest}` : `Chapter ${chapterNum}`;
};

export const lightNovelWorldNetScraper: SourceScraper = {
  id: "lightnovelworld-net",
  name: "LightNovelWorld.net",

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

    if (looksLikeChallengePage(html)) {
      throw new Error(
        `lightnovelworld.net: challenge page returned for ${url}`,
      );
    }

    // <h1 class="entry-title" itemprop="name">Title</h1>
    const title = decodeEntities(
      safeMatch(html, /<h1[^>]*class="entry-title"[^>]*>\s*([^<]+?)\s*<\/h1>/i) ??
        "Unknown Title",
    ).trim();

    // <div class="serl"><span class="sername">Author</span>
    //   <span class="serval"><a ...>Name</a>, <a ...>Name 2</a></span></div>
    const authorBlock = safeMatch(
      html,
      /<span class="sername">\s*Author\s*<\/span>\s*<span class="serval">([\s\S]*?)<\/span>/i,
    );
    const authors = authorBlock
      ? [...authorBlock.matchAll(/<a[^>]*>([^<]+)<\/a>/gi)]
          .map((m) => decodeEntities(m[1]).trim())
          .filter(Boolean)
      : [];
    const author = authors.length > 0 ? authors.join(", ") : "Unknown Author";

    // <meta property="og:image" content="https://.../cover.webp">
    const coverRaw =
      safeMatch(html, /<meta property="og:image" content="([^"]+)"/i) ??
      safeMatch(
        html,
        /<div class="sertothumb"[\s\S]*?<img[^>]*\ssrc="([^"]+)"/i,
      );
    const coverUrl = coverRaw
      ? makeAbsoluteUrl(decodeEntities(coverRaw), url)
      : "";

    // Synopsis: <div class="sersys entry-content ..."> with <p>...<br>...</p>.
    // Some pages use the plain-text "desc" block instead, so fall back to it.
    // Lines are split on <br> and newlines, then rejoined as paragraphs.
    const synopsisBlock =
      extractByDepth(html, 'class="sersys entry-content') ??
      extractByDepth(html, 'class="desc mindes') ??
      "";
    const synopsis = synopsisBlock
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .split("\n")
      .map((line) =>
        decodeEntities(stripTags(line)).replace(/\u00a0/g, " ").trim(),
      )
      .filter((line) => line.length > 0 && !/^(More|Less)$/i.test(line))
      .join("\n\n");

    // <li class="tseplsfrst" data-id="..."><a href="/...-chapter-1/">
    // Fallback: the "First Chapter" button in the header block.
    const firstHref =
      safeMatch(
        html,
        /<li[^>]*class="tseplsfrst"[^>]*>\s*<a href="([^"]+)"/i,
      ) ??
      safeMatch(html, /<a href="([^"]+)">\s*<span>First Chapter<\/span>/i);
    const firstChapterUrl = firstHref
      ? makeAbsoluteUrl(decodeEntities(firstHref), url)
      : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: lightnovelworld-net"],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    if (looksLikeChallengePage(html)) {
      throw new Error(
        `lightnovelworld.net: challenge page returned for ${url}`,
      );
    }

    // <div class="cat-series">Chapter 1 - 1 I've Long Since Wanted to Die!</div>
    const headingRaw = safeMatch(
      html,
      /<div class="cat-series">\s*([\s\S]*?)\s*<\/div>/i,
    );
    const headingText = headingRaw
      ? decodeEntities(stripTags(headingRaw)).replace(/\s+/g, " ").trim()
      : "";
    const title = headingText
      ? cleanChapterTitle(headingText, chapterNum)
      : `Chapter ${chapterNum}`;

    // Text lives in <div class="novel-content"> as <p class="chapter-paragraph">.
    // Fallback: the whole entry block, with boilerplate filtered out.
    const block =
      extractByDepth(html, 'class="novel-content"') ??
      extractByDepth(html, 'class="epcontent');
    if (!block) {
      throw new Error(`lightnovelworld.net: chapter content not found for ${url}`);
    }

    let paragraphs = paragraphsFrom(
      block.replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, ""),
    );
    // The first paragraph often repeats the heading ("Chapter 1: Chapter 1 ...").
    // Drop it only when it is short and starts with "Chapter N".
    if (
      paragraphs.length > 1 &&
      /^Chapter\s+\d+\b/i.test(paragraphs[0]) &&
      paragraphs[0].length < 150
    ) {
      paragraphs = paragraphs.slice(1);
    }
    const content = paragraphs.join("\n\n");

    // Fail loudly instead of saving an empty chapter.
    if (!content) {
      throw new Error(`lightnovelworld.net: empty chapter content for ${url}`);
    }

    // Next link (appears twice, top and bottom of the page):
    //   <a aria-label="next" href="/...-chapter-2/" rel="next">
    // The last chapter may keep the tag with a disabled attribute,
    // so check for that before accepting the href.
    const nextTag = html.match(/<a\b[^>]*\brel="next"[^>]*>/i)?.[0] ?? "";
    const nextHref = safeMatch(nextTag, /\shref="([^"]*)"/i);
    const nextDisabled = /\bdisabled\b/i.test(nextTag);
    const nextAbs =
      nextHref && !nextDisabled
        ? makeAbsoluteUrl(decodeEntities(nextHref), url)
        : null;
    const nextUrl =
      nextAbs && /-chapter-\d+\/?$/i.test(nextAbs) && nextAbs !== url
        ? nextAbs
        : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
