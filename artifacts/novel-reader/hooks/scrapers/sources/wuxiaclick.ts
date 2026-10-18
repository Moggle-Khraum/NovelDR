import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";

// wuxia.click (WuxiaClick) — Next.js (pages router) site.
// Selectors confirmed against a real novel page and chapter 1 dump of
// "Stop, Friendly Fire!". URL shapes:
//   novel:   /novel/{slug}              e.g. /novel/stop-friendly-fire
//   chapter: /chapter/{slug}-{n}        e.g. /chapter/stop-friendly-fire-1
// The novel's TOC is paginated (100 per page, ?page=N) but the app only
// needs the first-chapter link; chapters are then followed via rel="next".
//
// Only the apex + www hosts are accepted. old.wuxia.click is the legacy
// site (different markup, scheduled to go away) and must NOT match.
const HOSTS = new Set(["wuxia.click", "www.wuxia.click"]);

/** Cloudflare interstitial markers (a normal page never contains these). */
const looksLikeChallengePage = (html: string): boolean =>
  /<title>\s*Just a moment\.\.\.\s*<\/title>|_cf_chl_opt|challenge-platform\/h\/[^"'\s]*orchestrate|cf-turnstile|Verify you are human|Attention Required/i.test(
    html,
  );

/** Parse the Next.js __NEXT_DATA__ JSON blob, or null if missing/invalid. */
const parseNextData = (html: string): any | null => {
  const raw = safeMatch(
    html,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const cleanParagraph = (inner: string): string =>
  decodeEntities(stripTags(inner.replace(/<br\s*\/?>/gi, "\n")))
    .replace(/\u00a0/g, " ")
    .trim();

export const wuxiaClickScraper: SourceScraper = {
  id: "wuxiaclick",
  name: "WuxiaClick",

  canHandle: (url: string) => {
    try {
      return HOSTS.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    if (looksLikeChallengePage(html)) {
      throw new Error(`wuxiaclick: captcha/challenge page returned for ${url}`);
    }

    // Primary source: __NEXT_DATA__ -> props.pageProps.novel (clean JSON).
    const novel = parseNextData(html)?.props?.pageProps?.novel ?? null;

    // <h1 class="break-words font-display ...">Title</h1> (first h1 on page)
    const title = decodeEntities(
      novel?.title ??
        safeMatch(html, /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i) ??
        "Unknown Title",
    ).trim();

    // JSON: author.name ("Toy Car, Toika, 토이카"); HTML fallback is
    // <p ...>by <span class="text-foreground">Name</span></p>
    const author = decodeEntities(
      novel?.author?.name ??
        safeMatch(
          html,
          /<p[^>]*>\s*by\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
        ) ??
        "Unknown Author",
    ).trim();

    // og:image is the 480px webp cover. Fallback: build it from coverKey
    // (covers/v1/<hash> -> <hash>-480.webp on the same CDN).
    const ogImage = safeMatch(
      html,
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
    );
    const coverUrl = ogImage
      ? decodeEntities(ogImage)
      : novel?.coverKey
        ? `https://cdn.wuxiaworld.eu/${novel.coverKey}-480.webp`
        : "";

    // JSON description is plain text. Fallback: <div id="synopsis-text">
    // holding one <p> per paragraph.
    let synopsis = typeof novel?.description === "string"
      ? decodeEntities(novel.description).trim()
      : "";
    if (!synopsis) {
      const block = extractByDepth(html, 'id="synopsis-text"') ?? "";
      synopsis = [...block.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
        .map((m) => cleanParagraph(m[1]))
        .filter(Boolean)
        .join("\n\n");
    }

    // CONFIRMED: the "Read first chapter" button is
    // <a ... href="/chapter/{slug}-1"><svg>…</svg> Read first chapter</a>.
    // It is the authoritative link (novels may not start at chapter 1).
    // Fallbacks: build from JSON slug + firstChapterNumber, then the first
    // /chapter/ anchor anywhere on the page.
    let firstHref: string | null = null;
    for (const m of html.matchAll(
      /<a\b[^>]*\bhref="(\/chapter\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      if (/Read first chapter/i.test(m[2])) {
        firstHref = m[1];
        break;
      }
    }
    if (!firstHref && novel?.slug && novel?.firstChapterNumber != null) {
      firstHref = `/chapter/${novel.slug}-${novel.firstChapterNumber}`;
    }
    if (!firstHref) {
      firstHref = safeMatch(html, /\bhref="(\/chapter\/[^"]+)"/i);
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
      debugInfo: [
        `fetched via external scraper: wuxiaclick (${
          novel ? "next-data" : "html-fallback"
        })`,
      ],
    };
  },

  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    if (looksLikeChallengePage(html)) {
      throw new Error(`wuxiaclick: captcha/challenge page returned for ${url}`);
    }

    // CONFIRMED: <h1 class="reader-title ...">Chapter 1</h1>
    // Some titles come through with a dangling " -" (e.g. "Chapter 303 -"),
    // trimmed off.
    const title = decodeEntities(
      safeMatch(
        html,
        /<h1[^>]*class="[^"]*reader-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
      ) ?? `Chapter ${chapterNum}`,
    )
      .replace(/<[^>]*>/g, "")
      .replace(/\s*[-–—]\s*$/, "")
      .trim();

    // CONFIRMED: <div class="reader-text" id="chapter-content"> holds one
    // <p data-tts-paragraph="N"> per line, interleaved with ad blocks
    // (<div class="adsense-slot"> and <aside data-ad-placement=...>). The
    // house-ad <aside>s can carry their own <p> tags when server-rendered,
    // so strip them (and scripts/iframes) before reading any <p>.
    const rawBlock = extractByDepth(html, 'id="chapter-content"') ?? "";
    const block = rawBlock
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
      .replace(/<(script|style|iframe|ins)\b[\s\S]*?<\/\1>/gi, "");

    // Primary: only paragraphs tagged data-tts-paragraph (exactly the story
    // text). Fallback: every remaining <p> in the cleaned block.
    let paragraphs = [
      ...block.matchAll(
        /<p\b[^>]*\bdata-tts-paragraph\b[^>]*>([\s\S]*?)<\/p>/gi,
      ),
    ]
      .map((m) => cleanParagraph(m[1]))
      .filter(Boolean);

    if (paragraphs.length === 0) {
      paragraphs = [...block.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
        .map((m) => cleanParagraph(m[1]))
        .filter(Boolean);
    }

    const content = paragraphs.join("\n\n");

    // Fail loudly instead of saving a blank chapter.
    if (!content) {
      throw new Error(`wuxiaclick: empty chapter content for ${url}`);
    }

    // CONFIRMED: <a rel="next" class="..." href="/chapter/{slug}-2"> (shown
    // in the top and bottom nav bars; the mobile toolbar's Next has no rel).
    // NOT yet seen on the last chapter, so anything that isn't a real
    // /chapter/ link (disabled, #, javascript:, missing) ends the novel.
    let nextUrl: string | null = null;
    for (const m of html.matchAll(/<a\b[^>]*\brel="next"[^>]*>/gi)) {
      const tag = m[0];
      const href = safeMatch(tag, /\shref="([^"]*)"/i);
      const disabled = /\saria-disabled="true"|\sdisabled(?:=|\s|\/|>)/i.test(
        tag,
      );
      if (href && !disabled && /\/chapter\//.test(href)) {
        nextUrl = makeAbsoluteUrl(decodeEntities(href), url);
        break;
      }
    }

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
