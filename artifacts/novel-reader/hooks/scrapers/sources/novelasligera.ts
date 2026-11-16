// hooks/scrapers/sources/novelasligera.ts
//
// NovelasLigera / NOVA (novelasligeras.net) - Spanish translated novels.
// WordPress + WooCommerce + WPBakery: a novel is a WooCommerce "producto"
// page, a chapter is a normal post. The older domain novelasligera.com is
// still accepted so saved library links keep resolving.
//
// Parsers were written against saved copies of a real novel page and a real
// chapter page (see test fixtures for the structure they rely on).
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  extractByDepth,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";
import { extractParagraphs } from "./novelphoenix";

const HOSTS = ["novelasligeras.net", "novelasligera.com"];

const clean = (raw: string): string =>
  decodeEntities(stripTags(raw)).replace(/\s+/g, " ").trim();

/** Opening tag of the first <div> whose class list contains `className`. */
const findOpeningTag = (html: string, className: string): string | null => {
  const escaped = className.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(
    `<div[^>]*class="[^"]*\\b${escaped}\\b[^"]*"[^>]*>`,
    "i",
  );
  return html.match(re)?.[0] ?? null;
};

/** Inner HTML of the first <div class="...className..."> block, or null. */
const divInnerByClass = (html: string, className: string): string | null => {
  const open = findOpeningTag(html, className);
  return open ? extractByDepth(html, open) : null;
};

/** Cut every <div class="...className..."> block out of html. */
const removeDivsByClass = (html: string, className: string): string => {
  let out = html;
  // Bounded: a page has a handful of these, and the cap guarantees the loop
  // ends even on malformed HTML.
  for (let i = 0; i < 100; i++) {
    const open = findOpeningTag(out, className);
    if (!open) break;
    const inner = extractByDepth(out, open);
    if (inner === null) break;
    const start = out.indexOf(open);
    const end = start + open.length + inner.length;
    out =
      out.slice(0, start) +
      out.slice(out.startsWith("</div>", end) ? end + 6 : end);
  }
  return out;
};

/**
 * Cut ads, scripts and styles out of a block before reading its text. Google's
 * ad script also injects "Explore ..." widgets (div.google-anno-skip) into the
 * middle of paragraphs once it has run, which would otherwise end up in the
 * story text.
 */
const withoutNoise = (html: string): string =>
  removeDivsByClass(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<ins[\s\S]*?<\/ins>/gi, ""),
    "google-anno-skip",
  );

/** Paragraph text with blank / &nbsp;-only paragraphs dropped. */
const readParagraphs = (html: string): string =>
  extractParagraphs(html)
    .split(/\n\n/)
    .map((p) => p.replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

const readMetaContent = (html: string, property: string): string | null =>
  safeMatch(
    html,
    new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`, "i"),
  ) ??
  safeMatch(
    html,
    new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${property}"`, "i"),
  );

/** Value cell of a WooCommerce attribute row, e.g. name "escritor". */
const attributeValue = (html: string, name: string): string | null => {
  const raw = safeMatch(
    html,
    new RegExp(
      `attribute_pa_${name}"[^>]*>\\s*<th[^>]*>[\\s\\S]*?<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
      "i",
    ),
  );
  const value = raw ? clean(raw) : "";
  return value || null;
};

/**
 * Chapter number from a chapter link's text ("Capítulo 12: ...", sometimes
 * written without the accent) or, failing that, its URL slug
 * ("...-capitulo-12-novela-ligera/").
 */
const chapterNumber = (text: string, href: string): number | null => {
  const fromText = text.match(/cap[ií]tulo\s*(\d+(?:\.\d+)?)/i);
  if (fromText) return parseFloat(fromText[1]);
  const fromUrl = href.match(/capitulo-(\d+(?:\.\d+)?)/i);
  return fromUrl ? parseFloat(fromUrl[1]) : null;
};

/**
 * Pure parser for the novel (info) page. No network.
 */
export const parseNovelasLigeraMeta = (
  html: string,
  url: string,
): NovelMeta => {
  // <h1 class="product_title entry-title">Title</h1>
  const titleRaw = safeMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = (titleRaw && clean(titleRaw)) || "Unknown Title";

  // Author: the "Escritor" row of the product attributes table.
  const author = attributeValue(html, "escritor") ?? "Unknown Author";

  // Cover: og:image is the product image; the gallery link is the same file.
  const coverUrl =
    readMetaContent(html, "og:image") ??
    safeMatch(html, /data-large_image="([^"]+)"/i) ??
    "";

  // Synopsis: paragraphs of the product's short description. The page can
  // have injected ad blocks inside it, and NOVA signs it off with a
  // "Sinopsis por NOVA" credit line that is not part of the story.
  const synBlock = divInnerByClass(
    html,
    "woocommerce-product-details__short-description",
  );
  const synopsis = synBlock
    ? readParagraphs(withoutNoise(synBlock))
        .split("\n\n")
        .filter((p) => !/^sinopsis por\b/i.test(p))
        .join("\n\n")
    : "";

  // Chapter list: every chapter link inside the WPBakery tabs block
  // ("Capitulos del 01 al 10", ...). The tabs use two different layouts, so
  // match the links themselves rather than a wrapper. In-page tab anchors
  // (href="#tab-...") are skipped.
  const tabsBlock = divInnerByClass(html, "wpb_tour") ?? html;
  const chapters: { href: string; num: number | null }[] = [];
  const seen = new Set<string>();
  for (const m of tabsBlock.matchAll(
    /<a[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = m[1];
    if (!isSafeHref(href) || seen.has(href)) continue;
    const num = chapterNumber(clean(m[2]), href);
    if (num === null) continue; // not a chapter link
    seen.add(href);
    chapters.push({ href, num });
  }

  // First chapter = lowest chapter number; the list is not guaranteed to be
  // in order.
  let first = chapters[0];
  for (const c of chapters) {
    if (c.num !== null && (first.num === null || c.num < first.num)) first = c;
  }
  const firstChapterUrl = first ? makeAbsoluteUrl(first.href, url) : null;

  return {
    title,
    author,
    synopsis,
    coverUrl,
    firstChapterUrl,
    debugInfo: ["fetched via external scraper: novelasligera"],
  };
};

/**
 * "Siguiente" button of a chapter page:
 *   <a href="..." title="Capítulo 2: ..."><span>Siguiente</span>...</a>
 * It appears both above and below the text; the first one is used. The first
 * chapter has no "Anterior" button, and the last has presumably no
 * "Siguiente" one, but if it points back at the novel page it is ignored.
 */
const findNextUrl = (html: string, url: string): string | null => {
  const href = safeMatch(
    html,
    /<a[^>]*href="([^"]+)"[^>]*>\s*<span[^>]*>\s*Siguiente\s*<\/span>/i,
  );
  if (!href || href.startsWith("#") || !isSafeHref(href)) return null;
  const abs = makeAbsoluteUrl(href, url);
  return /\/producto\//i.test(abs) ? null : abs;
};

/**
 * Pure parser for a chapter page. No network.
 */
export const parseNovelasLigeraChapter = (
  html: string,
  url: string,
): ChapterData => {
  const entry = divInnerByClass(html, "entry-content") ?? html;
  const body = withoutNoise(entry);

  // The text block starts "<h1>Series</h1><h2>Volumen 1</h2><h2>Capítulo 1:
  // Title</h2>". The chapter heading is the h2 that says "Capítulo".
  let title = "";
  for (const m of body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const text = clean(m[1]);
    if (/cap[ií]tulo/i.test(text)) {
      title = text;
      break;
    }
  }
  if (!title) {
    // "<title>Serie Capítulo 1 Novela Ligera - NOVA</title>"
    const docTitle = safeMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    title = docTitle ? clean(docTitle).replace(/\s*[-–|]\s*NOVA\s*$/i, "") : "";
  }

  return {
    url,
    title,
    content: readParagraphs(body),
    nextUrl: findNextUrl(entry, url),
  };
};

export const novelasLigeraScraper: SourceScraper = {
  id: "novelasligera",
  name: "NovelasLigera",

  canHandle: (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);
    return parseNovelasLigeraMeta(html, url);
  },

  fetchChapter: async (
    url: string,
    _chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    return parseNovelasLigeraChapter(html, url);
  },
};
