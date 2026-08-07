// artifacts/novel-reader/hooks/useDirectScraper.ts
import axios from "axios";
import { decodeHTML } from "entities";

export interface NovelMeta {
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string;
  firstChapterUrl: string | null;
  debugInfo?: string[];
}

export interface ChapterListItem {
  number: number;
  title: string;
  url: string;
}

export interface ChapterData {
  url: string;
  title: string;
  content: string;
  nextUrl: string | null;
  scraperInfo?: {
    selector: "chapterText" | "chapter-text" | "generic-fallback";
    rawCount: number;
    filteredCount: number;
    htmlLength: number;
    pTagCount: number;
    fetchMethod: "fetch" | "fetch-proxy";
    httpStatus: number;
    jsInjected: boolean;
    chapterTextCount: number;
    contentType: string;
  };
}

// ─── Shared HTML helpers (used by remaining domains) ─────────────────────────

const stripTags = (html: string): string => {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const decodeEntities = (text: string): string => {
  if (!text) return "";
  try {
    return decodeHTML(text);
  } catch {
    return text;
  }
};

const safeMatch = (text: string, pattern: RegExp): string | null => {
  if (!text) return null;
  try {
    const match = text.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

const extractTitleFromUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    let path = parsedUrl.pathname;
    if (path.endsWith(".html")) path = path.slice(0, -5);
    const pathParts = path.split("/").filter((part) => part);
    let novelSlug = null;
    for (const part of pathParts) {
      if (part && !part.toLowerCase().includes("chapter") && part.length > 5) {
        novelSlug = part;
        break;
      }
    }
    if (!novelSlug && pathParts.length > 0) {
      novelSlug = pathParts[pathParts.length - 1];
    }
    if (novelSlug) {
      novelSlug = novelSlug.replace(/^\d+[\s\-\.]+/, "");
      const title = novelSlug.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
      return title
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
    return "Unknown Novel";
  } catch {
    return "Unknown Novel";
  }
};

const makeAbsoluteUrl = (relativeUrl: string, baseUrl: string): string => {
  if (!relativeUrl) return baseUrl;
  if (relativeUrl.startsWith("http")) return relativeUrl;
  if (relativeUrl.startsWith("/")) {
    try {
      const parsed = new URL(baseUrl);
      return `${parsed.protocol}//${parsed.host}${relativeUrl}`;
    } catch {
      return relativeUrl;
    }
  }
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
};

const delayMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Shared HTTP client ────────────────────────────────────────────────────────

const httpClient = axios.create({
  timeout: 50000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/jpeg,image/jpg,image/png,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  },
});

// ─── ASIANOVEL.NET isolated HTTP client ──────────────────────────────────────

const asianovelHttpClient = axios.create({
  timeout: 50000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  },
});

const fetchAsianovel = async (url: string): Promise<string> => {
  console.log("[Scraper] Fetching Asianovel via isolated client...");

  try {
    const response = await asianovelHttpClient.get(url);
    return response.data;
  } catch (error: any) {
    console.warn("[Scraper] Asianovel direct fetch failed:", error.message);
    await delayMs(2000);
    try {
      console.log("[Scraper] Retrying Asianovel with native fetch...");
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
      return await response.text();
    } catch (fetchError: any) {
      console.warn("[Scraper] Asianovel fetch API failed:", fetchError.message);
      await delayMs(2000);
      console.log("[Scraper] Retrying Asianovel with proxy...");
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const proxyResponse = await asianovelHttpClient.get(proxyUrl);
      return proxyResponse.data;
    }
  }
};

// ─── Generic fetch with fallback (only Asianovel special-casing remains) ────

const fetchWithFallback = async (
  url: string,
  isAsianovel: boolean = false,
): Promise<string> => {
  if (isAsianovel) {
    return await fetchAsianovel(url);
  }

  try {
    const response = await httpClient.get(url);
    return response.data;
  } catch (directError: any) {
    console.warn(
      "[Scraper] Direct fetch failed, waiting before retry:",
      directError.message,
    );
    await delayMs(2000);
    console.log("[Scraper] Retrying with proxy...");
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const proxyResponse = await httpClient.get(proxyUrl);
    return proxyResponse.data;
  }
};

// ─── LIGHTNOVELWORLD helpers ──────────────────────────────────────────────────

interface LnwFetchResult {
  html: string;
  fetchMethod: "fetch" | "fetch-proxy";
  httpStatus: number;
  contentType: string;
}

const fetchLightNovelWorld = async (url: string): Promise<LnwFetchResult> => {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
  };

  try {
    const response = await fetch(url, { headers });
    const html = await response.text();
    const chapterTextCount = (html.match(/id="chapterText"/g) || []).length;
    const pTagCount = (html.match(/<p[\s>]/gi) || []).length;
    console.log(
      `[LNW] Raw HTML: ${html.length} chars, #chapterText: ${chapterTextCount}, <p> tags: ${pTagCount}`,
    );
    return {
      html,
      fetchMethod: "fetch",
      httpStatus: response.status,
      contentType: response.headers.get("content-type") || "unknown",
    };
  } catch (err: any) {
    console.warn("[LNW] Direct fetch failed, trying proxy:", err.message);
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { headers });
    if (!proxyRes.ok) throw new Error(`Proxy HTTP ${proxyRes.status}`);
    const html = await proxyRes.text();
    return {
      html,
      fetchMethod: "fetch-proxy",
      httpStatus: proxyRes.status,
      contentType: proxyRes.headers.get("content-type") || "unknown",
    };
  }
};

const lnwExtractInnerHtml = (html: string): string | null => {
  const primaryMarker = 'id="chapterText"';
  let start = html.indexOf(primaryMarker);
  let usedFallback = false;

  if (start === -1) {
    start = html.indexOf('class="chapter-text');
    if (start === -1) return null;
    usedFallback = true;
    console.log("[LNW] Fallback selector (.chapter-text) matched");
  } else {
    console.log("[LNW] Primary selector (#chapterText) matched");
  }

  const openTagEnd = html.indexOf(">", start);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let i = openTagEnd + 1;

  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div", i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      i = nextClose + 5;
    }
  }

  let inner = html.slice(openTagEnd + 1, i);

  const removeNestedDivByClass = (
    source: string,
    classFragment: string,
  ): string => {
    let output = source;
    let searchFrom = 0;
    while (true) {
      const classIndex = output.indexOf(classFragment, searchFrom);
      if (classIndex === -1) break;
      const tagStart = output.lastIndexOf("<div", classIndex);
      const tagEnd = output.indexOf(">", classIndex);
      if (tagStart === -1 || tagEnd === -1) {
        searchFrom = classIndex + classFragment.length;
        continue;
      }
      let divDepth = 1;
      let cursor = tagEnd + 1;
      while (cursor < output.length && divDepth > 0) {
        const nextOpen = output.indexOf("<div", cursor);
        const nextClose = output.indexOf("</div", cursor);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          divDepth++;
          cursor = nextOpen + 4;
        } else {
          divDepth--;
          cursor = nextClose + 5;
        }
      }
      output = output.slice(0, tagStart) + output.slice(cursor);
      searchFrom = tagStart;
    }
    return output;
  };

  inner = removeNestedDivByClass(inner, "chapter-ad-container");
  inner = inner.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  inner = inner.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "");
  return inner;
};

const lnwExtractParagraphs = (
  html: string,
): {
  paragraphs: string[];
  selector: "chapterText" | "chapter-text" | "generic-fallback";
} => {
  const inner = lnwExtractInnerHtml(html);
  if (inner) {
    const rawParas = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(
      (m) => m[1],
    );
    if (rawParas.length > 0) {
      const usedFallbackClass = html.indexOf('id="chapterText"') === -1;
      const selector = usedFallbackClass ? "chapter-text" : "chapterText";
      console.log(
        `[LNW] Found ${rawParas.length} <p> paragraphs via #${selector}`,
      );
      return { paragraphs: rawParas, selector };
    }
  }
  console.warn(
    "[LNW] #chapterText extraction failed — falling through to generic <p> scan",
  );
  const fallback = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (m) => m[1],
  );
  console.log(`[LNW] Generic scan — ${fallback.length} raw paragraphs`);
  return { paragraphs: fallback, selector: "generic-fallback" };
};

const LNW_JUNK_PHRASES = [
  "text-to-speech is here",
  "create a free account",
  "unlock the full experience",
  "post comment",
  "verification code",
  "resend code",
  "staff account detected",
  "forgot password",
  "reset password",
  "light novel world",
  "your gateway to infinite stories",
  "loading chapters",
  "chapter comments",
  "login to comment",
  "please follow common sense",
  "spam, phishing",
];

const lnwFilterParagraphs = (rawParas: string[]): string[] => {
  const results: string[] = [];
  for (const p of rawParas) {
    const text = decodeEntities(stripTags(p)).trim();
    const lower = text.toLowerCase();
    if (text.length < 20) continue;
    if (LNW_JUNK_PHRASES.some((phrase) => lower.includes(phrase))) continue;
    results.push(text);
  }
  const deduped: string[] = [];
  for (const p of results) {
    if (deduped.length === 0 || p !== deduped[deduped.length - 1]) {
      deduped.push(p);
    }
  }
  return deduped;
};

// ─── ASIANOVEL.NET helpers ────────────────────────────────────────────────────

const findRealTagEnd = (html: string, fromIdx: number): number => {
  let i = fromIdx;
  let quoteChar: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = null;
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
    } else if (ch === ">") {
      return i;
    }
    i++;
  }
  return -1;
};

const extractAsianovelChapterContentHtml = (html: string): string | null => {
  const marker = 'id="chapter-content"';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const tagStart = html.lastIndexOf("<", markerIdx);
  if (tagStart === -1) return null;

  const openTagEnd = findRealTagEnd(html, tagStart);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let i = openTagEnd + 1;
  let contentEnd = -1;

  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<section", i);
    const nextClose = html.indexOf("</section", i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 8;
    } else {
      depth--;
      if (depth === 0) contentEnd = nextClose;
      i = nextClose + 9;
    }
  }

  if (contentEnd === -1) return null;
  return html.slice(openTagEnd + 1, contentEnd);
};

const extractAsianovelChapterLinks = (
  html: string,
  baseUrl: string,
): { url: string; title: string }[] => {
  const entries: { url: string; title: string }[] = [];
  const seenUrls = new Set<string>();

  const listBlockRegex =
    /<ol[^>]*class="[^"]*chapter-group__list[^"]*"[^>]*>([\s\S]*?)<\/ol>/gi;
  let listBlockMatch: RegExpExecArray | null;

  while ((listBlockMatch = listBlockRegex.exec(html)) !== null) {
    const listHtml = listBlockMatch[1];

    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;

    while ((liMatch = liRegex.exec(listHtml)) !== null) {
      const liInner = liMatch[1];

      const anchorMatch = liInner.match(
        /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!anchorMatch) continue;

      const chapterUrl = makeAbsoluteUrl(anchorMatch[1], baseUrl);
      if (seenUrls.has(chapterUrl)) continue;
      seenUrls.add(chapterUrl);

      const title = decodeEntities(stripTags(anchorMatch[2]))
        .replace(/\s+/g, " ")
        .trim();
      entries.push({ url: chapterUrl, title });
    }
  }

  const orderAttrMatch = html.match(/data-order="(asc|desc)"/i);
  const domOrder = orderAttrMatch ? orderAttrMatch[1].toLowerCase() : "asc";
  if (domOrder === "desc") entries.reverse();

  return entries;
};

const extractAsianovelChapterIndexList = (
  html: string,
  baseUrl: string,
): { position: number; url: string; title: string }[] => {
  const listMatch = html.match(
    /<ul[^>]*id="chapter-index-list"[^>]*>([\s\S]*?)<\/ul>/i,
  );
  if (!listMatch) return [];

  const listHtml = listMatch[1];
  const entries: { position: number; url: string; title: string }[] = [];

  const liRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(listHtml)) !== null) {
    const liAttrs = liMatch[1];
    const liInner = liMatch[2];

    const positionMatch = liAttrs.match(/data-position="(\d+)"/i);
    if (!positionMatch) continue;
    const position = parseInt(positionMatch[1], 10);

    const anchorMatch = liInner.match(
      /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchorMatch) continue;

    const url = makeAbsoluteUrl(anchorMatch[1], baseUrl);
    const title = decodeEntities(stripTags(anchorMatch[2]))
      .replace(/\s+/g, " ")
      .trim();

    entries.push({ position, url, title });
  }

  entries.sort((a, b) => a.position - b.position);
  return entries;
};

// ─── Main exports ──────────────────────────────────────────────────────────────

export const directFetchNovelMeta = async (url: string): Promise<NovelMeta> => {
  console.log("[Scraper] Fetching novel meta from:", url);

  try {
    const domainLower = url.toLowerCase();
    const isLightNovelWorld = domainLower.includes("lightnovelworld");
    const isAsianovel = domainLower.includes("asianovel.net");

    const html = await fetchWithFallback(url, isAsianovel);

    const asianovelDebug: string[] = [];
    if (isAsianovel) {
      const bodyIdx = html.indexOf("<body");
      asianovelDebug.push(`html length: ${html.length}`);
      asianovelDebug.push(
        `has chapter-group__list: ${html.includes("chapter-group__list")}`,
      );
      asianovelDebug.push(
        `has story__identity-title: ${html.includes("story__identity-title")}`,
      );
      asianovelDebug.push(
        `has story__thumbnail: ${html.includes("story__thumbnail")}`,
      );
      asianovelDebug.push(
        `<body> snippet: ${bodyIdx >= 0 ? html.slice(bodyIdx, bodyIdx + 300) : "(no <body> tag found)"}`,
      );
      asianovelDebug.push(`raw start: ${html.slice(0, 300)}`);
      asianovelDebug.forEach((line) => console.log("[DEBUG][Asianovel]", line));
    }

    let title = extractTitleFromUrl(url);
    let author = "Unknown Author";
    let synopsis = "No summary available.";
    let coverUrl = "";
    let firstChapterUrl: string | null = null;

    // ─── LIGHTNOVELWORLD ──────────────────────────────────────────────────────
    if (isLightNovelWorld) {
      console.log("[Scraper] LightNovelWorld detected");

      const titleMatch = safeMatch(
        html,
        /<h1[^>]*class="novel-title"[^>]*>([^<]+)<\/h1>/i,
      );
      if (titleMatch) title = decodeEntities(titleMatch);

      const authorMatch = safeMatch(
        html,
        /<p[^>]*class="novel-author"[^>]*>[\s\S]*?<a[^>]*class="author-link"[^>]*>([^<]+)<\/a>/i,
      );
      if (authorMatch) {
        author = decodeEntities(authorMatch.trim());
      } else {
        const authorFallback = safeMatch(
          html,
          /<p[^>]*class="novel-author"[^>]*>([\s\S]*?)<\/p>/i,
        );
        if (authorFallback) {
          author = decodeEntities(
            stripTags(authorFallback)
              .replace(/^Author:\s*/i, "")
              .trim(),
          );
        }
      }

      const coverMatch =
        safeMatch(
          html,
          /<img[^>]*class="novel-cover[^"]*"[^>]*src="([^"]+)"/i,
        ) ||
        safeMatch(html, /<img[^>]*src="([^"]+)"[^>]*class="novel-cover[^"]*"/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);

      const summaryMatch = safeMatch(
        html,
        /<div[^>]*class="summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
      if (summaryMatch) {
        const paragraphs = summaryMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          synopsis = paragraphs
            .map((p) => decodeEntities(stripTags(p)))
            .filter((t) => t.length > 0)
            .join("\n\n");
        }
      }

      const baseNovelUrl = url.replace(/\/$/, "");
      firstChapterUrl = `${baseNovelUrl}/chapter/1/`;
      console.log("[Scraper] Constructed first chapter URL:", firstChapterUrl);
    }

    // ─── ASIANOVEL.NET ────────────────────────────────────────────────────────
    if (isAsianovel) {
      console.log("[Scraper] Asianovel.net detected");

      const titleMatch = safeMatch(
        html,
        /<h1[^>]*class="[^"]*story__identity-title[^"]*"[^>]*>([^<]+)<\/h1>/i,
      );
      if (titleMatch) title = decodeEntities(titleMatch.trim());

      const authorMetaMatch = safeMatch(
        html,
        /<div[^>]*class="[^"]*story__identity-meta[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
      asianovelDebug.push(
        `author: story__identity-meta div found: ${!!authorMetaMatch}`,
      );
      if (authorMetaMatch) {
        asianovelDebug.push(
          `author: meta div raw content: ${authorMetaMatch.slice(0, 200)}`,
        );
        let authorAnchorMatch = authorMetaMatch.match(
          /<a[^>]*\bhref="[^"]*\/author\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
        );
        if (!authorAnchorMatch) {
          authorAnchorMatch = authorMetaMatch.match(
            /<a[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
          );
        }
        if (!authorAnchorMatch) {
          authorAnchorMatch = authorMetaMatch.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
        }
        asianovelDebug.push(`author: anchor matched: ${!!authorAnchorMatch}`);
        if (authorAnchorMatch) {
          asianovelDebug.push(
            `author: raw captured group: ${JSON.stringify(authorAnchorMatch[1])}`,
          );
          const cleanedAuthor = decodeEntities(stripTags(authorAnchorMatch[1]))
            .replace(/\s+/g, " ")
            .trim();
          asianovelDebug.push(
            `author: cleaned result: ${JSON.stringify(cleanedAuthor)}`,
          );
          if (cleanedAuthor) author = cleanedAuthor;
        }
      }

      const thumbFigureMatch = safeMatch(
        html,
        /<figure[^>]*class="[^"]*story__thumbnail[^"]*"[^>]*>([\s\S]*?)<\/figure>/i,
      );
      if (thumbFigureMatch) {
        let rawCover: string | undefined;

        const anchorTagMatch = thumbFigureMatch.match(/<a\b[^>]*>/i);
        if (anchorTagMatch) {
          const hrefMatch = anchorTagMatch[0].match(/\bhref="([^"]+)"/i);
          if (hrefMatch && /\.(jpe?g|png|webp)(\?.*)?$/i.test(hrefMatch[1])) {
            rawCover = hrefMatch[1];
          }
        }

        if (!rawCover) {
          const imgTagMatch = thumbFigureMatch.match(/<img\b[^>]*>/i);
          if (imgTagMatch) {
            const imgTag = imgTagMatch[0];
            const srcMatch = imgTag.match(/\bsrc="([^"]+)"/i);
            const dataSrcMatch = imgTag.match(/\bdata-src="([^"]+)"/i);
            rawCover = srcMatch?.[1] ?? dataSrcMatch?.[1];
          }
        }

        if (rawCover) coverUrl = makeAbsoluteUrl(rawCover, url);
      }

      const descMatch = safeMatch(
        html,
        /<section[^>]*class="[^"]*story__summary[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
      );
      if (descMatch) {
        const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map((p) => {
              let text = p.replace(/<p[^>]*>/i, "").replace(/<\/p>/i, "");
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter((t) => t.length > 0)
            .filter(
              (t) => !/^related\s+(stories|posts|series)\s*:?\s*$/i.test(t),
            )
            .filter((t) => !/^no\s+related\s+(posts|stories)\.?\s*$/i.test(t));
          synopsis = cleanedParagraphs.join("\n\n");
        } else {
          synopsis = decodeEntities(stripTags(descMatch));
        }

        synopsis = synopsis
          .replace(/related\s+(stories|posts|series)\s*:[\s\S]*$/i, "")
          .trim();
      }

      const asianovelChapterLinkRegex = /<a\b[^>]*>/gi;
      let chapterLinkTagMatch: RegExpExecArray | null;
      while (
        (chapterLinkTagMatch = asianovelChapterLinkRegex.exec(html)) !== null
      ) {
        const tag = chapterLinkTagMatch[0];
        if (!/class="[^"]*chapter-group__list-item-link[^"]*"/i.test(tag))
          continue;
        const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
        if (hrefMatch && hrefMatch[1]) {
          firstChapterUrl = makeAbsoluteUrl(hrefMatch[1], url);
          console.log(
            "[Scraper] Asianovel first chapter URL (chapter-group__list-item-link):",
            firstChapterUrl,
          );
        }
        break;
      }

      if (!firstChapterUrl) {
        const jsonLdBlocks = html.match(
          /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
        );
        if (jsonLdBlocks) {
          for (const block of jsonLdBlocks) {
            const inner = safeMatch(
              block,
              /<script[^>]*>([\s\S]*?)<\/script>/i,
            );
            if (!inner) continue;
            try {
              const data = JSON.parse(inner);
              const graph = Array.isArray(data)
                ? data
                : data["@graph"] || [data];
              for (const node of graph) {
                if (
                  node &&
                  node["@type"] === "ItemList" &&
                  node["name"] === "Chapters"
                ) {
                  const items = node.itemListElement || [];
                  if (items.length > 0 && items[0].url) {
                    firstChapterUrl = makeAbsoluteUrl(items[0].url, url);
                    console.log(
                      "[Scraper] Asianovel first chapter URL (JSON-LD fallback):",
                      firstChapterUrl,
                    );
                  }
                }
              }
            } catch {
              // skip
            }
            if (firstChapterUrl) break;
          }
        }
      }

      if (!firstChapterUrl) {
        const chapterEntries = extractAsianovelChapterLinks(html, url);
        if (chapterEntries.length > 0) {
          firstChapterUrl = chapterEntries[0].url;
          console.log(
            "[Scraper] Asianovel first chapter URL (chapter list DOM):",
            firstChapterUrl,
          );
        } else {
          console.log(
            "[Scraper] Asianovel: could not determine first chapter URL",
          );
        }
      }
    }

    console.log("[Scraper] Found first chapter:", firstChapterUrl);
    console.log("[Scraper] Found cover URL:", coverUrl);

    return {
      title: decodeEntities(title),
      author: decodeEntities(author),
      synopsis: decodeEntities(synopsis),
      coverUrl,
      firstChapterUrl,
      debugInfo: isAsianovel ? asianovelDebug : undefined,
    };
  } catch (error: any) {
    console.error("[Scraper] Error:", error.message);
    throw new Error(`Failed to fetch novel: ${error.message}`);
  }
};

export const directFetchAsianovelChapterList = async (
  url: string,
): Promise<ChapterListItem[]> => {
  try {
    const html = await fetchAsianovel(url);
    const entries = extractAsianovelChapterLinks(html, url);

    const chapters: ChapterListItem[] = entries.map((entry, index) => {
      let chapterNumber: number | null = null;
      const textNumMatch = entry.title.match(/(?:chapter\s*)?(\d+)/i);
      if (textNumMatch) chapterNumber = parseInt(textNumMatch[1], 10);

      if (chapterNumber === null || Number.isNaN(chapterNumber)) {
        chapterNumber = index + 1;
      }

      return {
        number: chapterNumber,
        title: entry.title || `Chapter ${chapterNumber}`,
        url: entry.url,
      };
    });

    console.log(
      `[Scraper] Asianovel chapter list: found ${chapters.length} chapters`,
    );
    return chapters;
  } catch (error: any) {
    console.error(
      "[Scraper] Error fetching Asianovel chapter list:",
      error.message,
    );
    throw new Error(`Failed to fetch chapter list: ${error.message}`);
  }
};

export const directFetchChapter = async (
  url: string,
  chapterNum: number,
): Promise<ChapterData> => {
  console.log("[Scraper] Fetching chapter:", url);

  try {
    const domainLower = url.toLowerCase();
    const isLightNovelWorld = domainLower.includes("lightnovelworld");
    const isAsianovel = domainLower.includes("asianovel.net");

    let html: string;
    let fetchMethod: "fetch" | "fetch-proxy" = "fetch";
    let httpStatus = 200;
    let contentType = "text/html";

    if (isLightNovelWorld) {
      const result = await fetchLightNovelWorld(url);
      html = result.html;
      fetchMethod = result.fetchMethod;
      httpStatus = result.httpStatus;
      contentType = result.contentType;
    } else {
      html = await fetchWithFallback(url, isAsianovel);
    }

    let title = `Chapter ${chapterNum}`;
    let skipCleanup = false;

    // ─── LIGHTNOVELWORLD ──────────────────────────────────────────────────────
    if (isLightNovelWorld) {
      const titleMatch =
        safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
        safeMatch(
          html,
          /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i,
        ) ||
        safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim())
          .replace(/\s+/g, " ")
          .trim();
        rawTitle = rawTitle
          .replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, "")
          .trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }

    // ─── ASIANOVEL.NET ────────────────────────────────────────────────────────
    if (isAsianovel) {
      const titleMatch =
        safeMatch(
          html,
          /<h1[^>]*class="[^"]*chapter__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        ) || safeMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(stripTags(titleMatch))
          .replace(/\s+/g, " ")
          .trim();
        rawTitle = rawTitle
          .replace(/^Chapter\s+\d+\s*[:.\-–—]?\s*/gi, "")
          .trim();
        if (rawTitle) {
          title = `Chapter ${chapterNum}: ${rawTitle}`;
          skipCleanup = true;
        }
      }
    }

    let paragraphMatches = null;

    // ─── LNW EARLY RETURN ────────────────────────────────────────────────────
    if (isLightNovelWorld) {
      const { paragraphs, selector } = lnwExtractParagraphs(html);
      const filtered = lnwFilterParagraphs(paragraphs);
      console.log(
        `[LNW] Extracted ${paragraphs.length}, kept ${filtered.length} after filtering`,
      );

      return {
        url,
        title: decodeEntities(title),
        content: filtered.join("\n\n") || "No content available.",
        nextUrl: (() => {
          const linkRegex2 = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
          let lm2: RegExpExecArray | null;
          while ((lm2 = linkRegex2.exec(html)) !== null) {
            const hrefM = lm2[1].match(/href=["']([^"']+)["']/i);
            const href2 = hrefM ? hrefM[1] : null;
            const txt2 = stripTags(lm2[2]).toLowerCase();
            const cls2 =
              (lm2[1].match(/class=["']([^"']*)["']/i) ||
                [])[1]?.toLowerCase() ?? "";
            const id2 =
              (lm2[1].match(/id=["']([^"']*)["']/i) || [])[1]?.toLowerCase() ??
              "";
            const attrs2 = cls2 + " " + id2;
            if (
              (txt2.includes("next") ||
                attrs2.includes("next") ||
                attrs2.includes("next_chapter")) &&
              href2
            ) {
              const next = makeAbsoluteUrl(href2, url);
              console.log("[Scraper] Found next chapter:", next);
              return next;
            }
          }
          console.log("[Scraper] No next chapter found.");
          return null;
        })(),
        scraperInfo: {
          selector: selector,
          rawCount: paragraphs.length,
          filteredCount: filtered.length,
          htmlLength: html.length,
          pTagCount: (html.match(/<p[\s>]/gi) || []).length,
          fetchMethod: fetchMethod,
          httpStatus: httpStatus,
          jsInjected: false,
          chapterTextCount: (html.match(/id="chapterText"/g) || []).length,
          contentType: contentType,
        },
      };
    }

    // ─── GENERIC PARAGRAPH EXTRACTION (for Asianovel and any fallback) ──────
    if (!paragraphMatches) {
      paragraphMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gis);
    }

    const validParagraphs: string[] = [];

    if (paragraphMatches) {
      for (const p of paragraphMatches) {
        let text = stripTags(p);
        text = decodeEntities(text);
        if (
          text.length > 5 &&
          !text.toLowerCase().includes("next chapter") &&
          !text.toLowerCase().includes("previous chapter") &&
          !text.toLowerCase().includes("back to") &&
          !text.toLowerCase().includes("table of contents")
        ) {
          validParagraphs.push(text);
        }
      }
    }

    let content = "";

    // ─── ASIANOVEL SPECIFIC CONTENT EXTRACTION ──────────────────────────────
    if (isAsianovel) {
      let contentHtml: string | null = extractAsianovelChapterContentHtml(html);

      if (!contentHtml) {
        const ATTR = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
        const ASIANOVEL_CONTENT_SELECTORS: RegExp[] = [
          new RegExp(
            `<section${ATTR}class="[^"]*chapter-formatting[^"]*"${ATTR}>([\\s\\S]*?)<\\/section>`,
            "i",
          ),
          new RegExp(
            `<div${ATTR}class="[^"]*chapter-formatting[^"]*"${ATTR}>([\\s\\S]*?)<\\/div>`,
            "i",
          ),
          new RegExp(
            `<[a-z]+${ATTR}\\bid="chapter-content"${ATTR}>([\\s\\S]*?)<\\/(?:div|section|article)>`,
            "i",
          ),
          new RegExp(
            `<div${ATTR}class="[^"]*chapter__content[^"]*"${ATTR}>([\\s\\S]*?)<\\/div>`,
            "i",
          ),
          new RegExp(
            `<[a-z]+${ATTR}class="[^"]*content-section[^"]*"${ATTR}>([\\s\\S]*?)<\\/(?:div|section)>`,
            "i",
          ),
        ];

        for (const selector of ASIANOVEL_CONTENT_SELECTORS) {
          const match = safeMatch(html, selector);
          if (match) {
            contentHtml = match;
            break;
          }
        }
      }

      if (contentHtml) {
        contentHtml = contentHtml
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "");

        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map((p) => {
              let text = p.replace(/<p[^>]*>/i, "").replace(/<\/p>/i, "");
              text = text.replace(/<br\s*\/?>/gi, "\n");
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter((t) => t.length > 0);
          content = cleanedParagraphs.join("\n\n");
        }
        if (!content) {
          let text = decodeEntities(stripTags(contentHtml));
          text = text
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*\n\s*\n+/g, "\n\n")
            .trim();
          if (text) content = text;
        }
      }
    }

    // ─── FALLBACK: use validParagraphs if nothing else worked ──────────────
    if (!content && validParagraphs.length > 0) {
      content = validParagraphs.join("\n\n");
    }

    // ─── GENERIC FALLBACK CONTENT BLOCK (for remaining sites) ──────────────
    if (!content) {
      const contentMatch =
        safeMatch(
          html,
          /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
        ) ||
        safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i) ||
        safeMatch(
          html,
          /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
        ) ||
        safeMatch(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
        safeMatch(html, /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i);
      if (contentMatch) {
        const innerParagraphs = contentMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
        if (innerParagraphs) {
          const texts: string[] = [];
          for (const p of innerParagraphs) {
            let text = stripTags(p);
            text = decodeEntities(text);
            if (text.length > 5) texts.push(text);
          }
          content = texts.join("\n\n");
        } else {
          content = decodeEntities(stripTags(contentMatch));
        }
      }
    }

    // ─── NEXT URL (with Asianovel index-list special case) ──────────────────
    let nextUrl: string | null = null;

    if (isAsianovel) {
      const indexEntries = extractAsianovelChapterIndexList(html, url);
      if (indexEntries.length > 0) {
        const normalize = (u: string) => u.replace(/\/$/, "").toLowerCase();
        const currentIndex = indexEntries.findIndex(
          (e) => normalize(e.url) === normalize(url),
        );
        if (currentIndex !== -1 && currentIndex + 1 < indexEntries.length) {
          nextUrl = indexEntries[currentIndex + 1].url;
          console.log(
            "[Scraper] Asianovel next chapter (data-position index):",
            nextUrl,
          );
        } else if (currentIndex === -1) {
          console.log(
            "[Scraper] Asianovel: current chapter not found in index list, trying story-page chapter list",
          );
        } else {
          console.log(
            "[Scraper] Asianovel: this is the last chapter in the list",
          );
        }
      }
      if (!nextUrl) {
        const chapterEntries = extractAsianovelChapterLinks(html, url);
        if (chapterEntries.length > 0) {
          const normalize = (u: string) => u.replace(/\/$/, "").toLowerCase();
          const currentIndex = chapterEntries.findIndex(
            (e) => normalize(e.url) === normalize(url),
          );
          if (currentIndex !== -1 && currentIndex + 1 < chapterEntries.length) {
            nextUrl = chapterEntries[currentIndex + 1].url;
            console.log(
              "[Scraper] Asianovel next chapter (chapter-group__list fallback):",
              nextUrl,
            );
          }
        }
      }
    }

    const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    const normalizeForCompare = (u: string) =>
      u.split("#")[0].replace(/\/$/, "").toLowerCase();
    const currentPageNormalized = normalizeForCompare(url);

    while (!nextUrl && (linkMatch = linkRegex.exec(html)) !== null) {
      const attrsStr = linkMatch[1];
      const innerHtml = linkMatch[2];
      const hrefMatch = attrsStr.match(/href=["']([^"']+)["']/i);
      const href = hrefMatch ? hrefMatch[1] : null;
      const txt = stripTags(innerHtml).toLowerCase();
      const classMatch = attrsStr.match(/class=["']([^"']*)["']/i);
      const classAttr = classMatch ? classMatch[1].toLowerCase() : "";
      const idMatch = attrsStr.match(/id=["']([^"']*)["']/i);
      const idAttr = idMatch ? idMatch[1].toLowerCase() : "";
      const attrs = classAttr + " " + idAttr;

      if (
        (txt.includes("next") ||
          txt.includes("next chapter") ||
          attrs.includes("next") ||
          attrs.includes("next_chapter")) &&
        href
      ) {
        const isPlaceholder =
          !href ||
          href === "#" ||
          href.startsWith("javascript:") ||
          href.trim() === "";
        const resolved = isPlaceholder ? null : makeAbsoluteUrl(href, url);
        const isSelfReference =
          resolved !== null &&
          normalizeForCompare(resolved) === currentPageNormalized;

        if (!isPlaceholder && !isSelfReference && resolved) {
          nextUrl = resolved;
          console.log("[Scraper] Found next chapter:", nextUrl);
          break;
        } else {
          console.log(
            '[Scraper] Skipped placeholder/self-referencing "next" link:',
            href,
          );
        }
      }
    }

    if (!nextUrl) {
      console.log("[Scraper] No next chapter found.");
    }

    return {
      url,
      title: decodeEntities(title),
      content: content || "No content available.",
      nextUrl,
    };
  } catch (error: any) {
    console.error("[Scraper] Error:", error.message);
    throw new Error(`Failed to fetch chapter: ${error.message}`);
  }
};

export async function downloadNovelByCrawling(
  startUrl: string,
  novelId: string,
  saveChapter: (
    novelId: string,
    chapterIndex: number,
    title: string,
    content: string,
  ) => Promise<void>,
  onProgress?: (chapterNumber: number, title: string) => void,
  delayMs: number = 500,
): Promise<void> {
  let currentUrl: string | null = startUrl;
  let chapterNumber = 1;

  while (currentUrl) {
    console.log(
      `[Downloader] Fetching chapter ${chapterNumber} from ${currentUrl}`,
    );

    try {
      const chapter = await directFetchChapter(currentUrl, chapterNumber);
      await saveChapter(novelId, chapterNumber, chapter.title, chapter.content);

      if (onProgress) {
        onProgress(chapterNumber, chapter.title);
      }

      currentUrl = chapter.nextUrl;
      chapterNumber++;

      if (delayMs > 0 && currentUrl) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error: any) {
      console.error(
        `[Downloader] Failed at chapter ${chapterNumber}:`,
        error.message,
      );
      throw new Error(
        `Download failed at chapter ${chapterNumber}: ${error.message}`,
      );
    }
  }

  console.log(`[Downloader] Completed. Total chapters: ${chapterNumber - 1}`);
}
