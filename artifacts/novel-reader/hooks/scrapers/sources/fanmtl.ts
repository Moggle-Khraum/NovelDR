import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

// fanmtl.com — custom CMS (not the novel-bin family, not Laravel).
// All selectors below were confirmed against real page dumps (a novel page
// and chapter 1). URL shapes:
//   novel:   /novel/{id}.html          e.g. /novel/kks39604.html
//   chapter: /novel/{id}_{n}.html      e.g. /novel/kks39604_1.html
const BASE_HOST = "fanmtl.com";

/**
 * The site sits behind Cloudflare. Normal pages carry the passive
 * /cdn-cgi/challenge-platform/scripts/jsd/ snippet, so that path is NOT a
 * block signal. These markers only appear on a real interstitial page
 * (confirmed on the Empire Novel block page: "Just a moment...",
 * _cf_chl_opt, /challenge-platform/h/.../orchestrate/).
 */
const looksLikeChallengePage = (html: string): boolean =>
  /<title>\s*Just a moment\.\.\.\s*<\/title>|_cf_chl_opt|challenge-platform\/h\/[^"'\s]*orchestrate|cf-turnstile|Verify you are human|Attention Required/i.test(
    html,
  );

/**
 * Every <p> in a block, trimmed, empties dropped. Used for both the synopsis
 * and the chapter body (both are plain <p>-per-paragraph on this site).
 */
const extractParagraphs = (html: string): string =>
  [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeEntities(stripTags(m[1].replace(/<br\s*\/?>/gi, "\n")))
        .replace(/\u00a0/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");

export const fanMtlScraper: SourceScraper = {
  id: "fanmtl",
  name: "FanMTL",

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

    // Without this, a block page would come back as "Unknown Title".
    if (looksLikeChallengePage(html)) {
      throw new Error(`fanmtl: captcha/challenge page returned for ${url}`);
    }

    // <h1 itemprop="name" class="novel-title text2row">Title</h1>
    const title = decodeEntities(
      safeMatch(html, /<h1[^>]*itemprop="name"[^>]*>\s*([^<]+?)\s*<\/h1>/i) ??
        "Unknown Title",
    ).trim();

    // <span itemprop="author">Author</span>
    // (some novels show 佚名, i.e. "anonymous", which is kept as-is)
    const author = decodeEntities(
      safeMatch(
        html,
        /<span[^>]*itemprop="author"[^>]*>\s*([^<]+?)\s*<\/span>/i,
      ) ?? "Unknown Author",
    ).trim();

    // <figure class="cover"><img class="" src="/d/file/kk101/xxxx.jpg" ...>
    // Exact class="cover" so the related-novel covers (class="novel-cover")
    // further down the page can't match.
    // Lazy-loaded pages keep the real URL in data-src (or similar) and put
    // a placeholder in src, so look at the lazy attributes first and ignore
    // inline data: placeholders.
    const coverImgTag =
      html.match(/<figure[^>]*class="cover"[^>]*>\s*(<img[^>]*>)/i)?.[1] ?? "";
    const coverRaw =
      [
        safeMatch(coverImgTag, /\sdata-src="([^"]+)"/i),
        safeMatch(coverImgTag, /\sdata-original="([^"]+)"/i),
        safeMatch(coverImgTag, /\sdata-lazy-src="([^"]+)"/i),
        safeMatch(coverImgTag, /\ssrc="([^"]+)"/i),
      ].find((v) => v && !/^data:/i.test(v)) ?? null;
    const coverUrl = coverRaw
      ? makeAbsoluteUrl(decodeEntities(coverRaw), url)
      : "";

    // <div class="summary"><h4>Summary</h4><div class="content"><p>...</p></div></div>
    const summaryBlock = extractByDepth(html, 'class="summary"');
    const synopsis = summaryBlock ? extractParagraphs(summaryBlock) : "";

    // <a id="readchapterbtn" href="/novel/kks39604_1.html" title="Chapter 1 ...">
    const firstHref = safeMatch(
      html,
      /<a[^>]*id="readchapterbtn"[^>]*\shref="([^"]+)"/i,
    );
    const firstChapterUrl = firstHref ? makeAbsoluteUrl(firstHref, url) : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: fanmtl"],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // CONFIRMED: <header class="chapter-header"> ... <div class="titles">
    //   <h1><a>Novel title</a></h1><h2>Chapter 1 World Book</h2>
    // Fallback: <title>Novel - Chapter title</title>
    const title = decodeEntities(
      safeMatch(
        html,
        /<div[^>]*class="titles"[^>]*>[\s\S]*?<h2[^>]*>\s*([^<]+?)\s*<\/h2>/i,
      ) ??
        safeMatch(html, /<title>[^<]*?\s-\s([^<]+)<\/title>/i) ??
        `Chapter ${chapterNum}`,
    ).trim();

    // CONFIRMED: <div class="chapter-content"> holds ad containers and
    // <script> tags mixed in with one <p> per line (some ad scripts sit
    // inside a <p>). Strip scripts first, then take only the <p> tags, so
    // the ad <div>s between paragraphs never leak in.
    const rawBlock =
      extractByDepth(html, 'class="chapter-content"') ??
      safeMatch(
        html,
        /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<div[^>]*class="chapternav/i,
      );

    if (!rawBlock) {
      throw new Error(
        looksLikeChallengePage(html)
          ? `fanmtl: captcha/challenge page returned for ${url}`
          : `fanmtl: chapter content not found for ${url}`,
      );
    }

    const content = extractParagraphs(
      rawBlock.replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, ""),
    );

    // Fail loudly instead of saving a blank chapter.
    if (!content) {
      throw new Error(
        looksLikeChallengePage(html)
          ? `fanmtl: captcha/challenge page returned for ${url}`
          : `fanmtl: empty chapter content for ${url}`,
      );
    }

    // CONFIRMED on chapter 1: the next link appears twice (header + bottom):
    //   <a class=" chnav next" href="/novel/kks39604_2.html" ...>
    //   <a class="nextchap" href="/novel/kks39604_2.html" ...>
    // The prev link on chapter 1 shows the disabled form:
    //   <a class="isDisabled chnav prev" href="javascript:;">
    // Assumed the next link looks the same on the last chapter (NOT yet seen),
    // so only accept /novel/{id}_{n}.html URLs of an enabled link that differ
    // from the current page.
    const nextTag =
      html.match(
        /<a\b[^>]*class="[^"]*\b(?:next|nextchap)\b[^"]*"[^>]*>/i,
      )?.[0] ?? "";
    const nextHref = safeMatch(nextTag, /\shref="([^"]*)"/i);
    const nextClass = safeMatch(nextTag, /class="([^"]*)"/i) ?? "";
    const isDisabled = /\bisDisabled\b/i.test(nextClass);
    const nextAbs =
      nextHref && !isDisabled
        ? makeAbsoluteUrl(decodeEntities(nextHref), url)
        : null;
    const nextUrl =
      nextAbs && /\/novel\/[^/]+_\d+\.html$/i.test(nextAbs) && nextAbs !== url
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
