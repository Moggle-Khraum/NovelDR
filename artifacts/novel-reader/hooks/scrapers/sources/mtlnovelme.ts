import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";

// mtlnovel.me — Bootstrap-based site ("MTL Novel").
// Confirmed against real page dumps (novel page + chapter 1):
//   novel:   /info/{slug}/                       e.g. /info/i-have-a-time-and-space-garden/
//   chapter: /read/{slug}/chapter-{n}-{title}/   e.g. /read/i-have-a-time-and-space-garden/chapter-1-opening-1-time-and-space-garden/
//
// The chapter list is NOT in the server HTML. The page loads it with:
//   fetch('/ajax/chapters/?slug={slug}') -> $('#list-chapters').html(data)
// so the scraper requests that endpoint directly, and falls back to any
// chapter links that happen to be present in the page.
const BASE_HOST = "mtlnovel.me";

const looksLikeChallengePage = (html: string): boolean =>
  /<title>\s*Just a moment\.\.\.\s*<\/title>|_cf_chl_opt|cf-turnstile|Verify you are human|Attention Required/i.test(
    html,
  );

const slugFromNovelUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    // /info/{slug}/  or  /read/{slug}/...
    return parts.length >= 2 ? parts[1] : null;
  } catch {
    return null;
  }
};

/**
 * Chapter text is one <p> per paragraph. Some paragraphs carry an injected
 * site watermark ("UU reading www. uukanshu. ...") in the middle of a
 * sentence. Those paragraphs are dropped whole, because cutting only the
 * watermark leaves a broken sentence behind.
 */
const isWatermarkParagraph = (text: string): boolean => /uukanshu/i.test(text);

const paragraphsFrom = (block: string): string[] =>
  [...block.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeEntities(stripTags(m[1]))
        .replace(/\u00a0/g, " ")
        .replace(/\u3000/g, " ")
        .trim(),
    )
    .filter((t) => t.length > 0 && !isWatermarkParagraph(t));

/** True when the URL points at a /read/{slug}/... chapter page. */
const isChapterUrl = (url: string | null): boolean => {
  if (!url) return false;
  try {
    return /^\/read\/[^/]+\/.+/.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** First chapter link from a chapter-list fragment (ajax or in-page). */
const firstChapterHref = (fragment: string): string | null =>
  safeMatch(fragment, /<p class="update-box-chapter">\s*<a href="([^"]+)"/i);

export const mtlNovelMeScraper: SourceScraper = {
  id: "mtlnovel-me",
  name: "MTLNovel.me",

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
      throw new Error(`mtlnovel.me: challenge page returned for ${url}`);
    }

    // First <h5 class="m-card-header"> on the page is the novel title.
    // Later headers ("Novel Summary", "Chapter List") come after it.
    const title = decodeEntities(
      safeMatch(html, /<h5 class="m-card-header">\s*([^<]+?)\s*<\/h5>/i) ??
        "Unknown Title",
    ).trim();

    // <li><span class="text-bold">Author:</span><span class="pull-right">
    //   <a href="/author/...">Name</a></span></li>
    const authorBlock = safeMatch(
      html,
      /<span class="text-bold">Author:<\/span>\s*<span class="pull-right">([\s\S]*?)<\/span>/i,
    );
    const authors = authorBlock
      ? [...authorBlock.matchAll(/<a[^>]*>([^<]+)<\/a>/gi)]
          .map((m) => decodeEntities(m[1]).trim())
          .filter(Boolean)
      : [];
    const author = authors.length > 0 ? authors.join(", ") : "Unknown Author";

    // <div class="content-main-image"><img src="/imgs/...webp" ...>
    const coverRaw = safeMatch(
      html,
      /<div class="content-main-image">\s*<img[^>]*\ssrc="([^"]+)"/i,
    );
    const coverUrl = coverRaw
      ? makeAbsoluteUrl(decodeEntities(coverRaw), url)
      : "";

    // <h5 class="m-card-header">Novel Summary</h5> then plain text lines
    // until the closing </div>.
    const summaryBlock =
      safeMatch(
        html,
        /<h5 class="m-card-header">Novel Summary<\/h5>\s*([\s\S]*?)\s*<\/div>/i,
      ) ?? "";
    const synopsis = summaryBlock
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map((line) =>
        decodeEntities(stripTags(line))
          .replace(/\u00a0/g, " ")
          .trim(),
      )
      .filter((line) => line.length > 0)
      .join("\n\n");

    // First chapter: prefer the list the site loads by AJAX, then any
    // chapter links already in the page.
    let firstHref: string | null = null;
    const slug = slugFromNovelUrl(url);
    if (slug) {
      try {
        const origin = new URL(url).origin;
        const listHtml = await fetchHtmlWithFallback(
          `${origin}/ajax/chapters/?slug=${encodeURIComponent(slug)}`,
        );
        firstHref = firstChapterHref(listHtml);
      } catch {
        // Fall through to the in-page list.
      }
    }
    if (!firstHref) {
      firstHref = firstChapterHref(html);
    }
    const firstChapterUrl = firstHref
      ? makeAbsoluteUrl(decodeEntities(firstHref), url)
      : null;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: mtlnovel-me"],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    if (looksLikeChallengePage(html)) {
      throw new Error(`mtlnovel.me: challenge page returned for ${url}`);
    }

    // <h5>Chapter 1: Opening 1 time and space garden</h5>
    const headingRaw = safeMatch(html, /<h5>\s*(Chapter[^<]+?)\s*<\/h5>/i);
    const heading = headingRaw
      ? decodeEntities(headingRaw).replace(/\s+/g, " ").trim()
      : "";
    const title = heading || `Chapter ${chapterNum}`;

    // <div class="content text-break"> ... <p>...</p> ... </div>
    const block = safeMatch(
      html,
      /<div class="content text-break">([\s\S]*?)<\/div>/i,
    );
    if (!block) {
      throw new Error(`mtlnovel.me: chapter content not found for ${url}`);
    }

    const content = paragraphsFrom(
      block.replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, ""),
    ).join("\n\n");

    if (!content) {
      throw new Error(`mtlnovel.me: empty chapter content for ${url}`);
    }

    // <a class="btn btn-next" href="/read/.../chapter-2-.../">
    // The last chapter may keep the tag with a disabled attribute.
    const nextTag = html.match(/<a[^>]*class="btn btn-next"[^>]*>/i)?.[0] ?? "";
    const nextHref = safeMatch(nextTag, /\shref="([^"]*)"/i);
    const nextDisabled = /\bdisabled\b/i.test(nextTag);
    const nextAbs =
      nextHref && !nextDisabled
        ? makeAbsoluteUrl(decodeEntities(nextHref), url)
        : null;
    const nextUrl = isChapterUrl(nextAbs) && nextAbs !== url ? nextAbs : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
