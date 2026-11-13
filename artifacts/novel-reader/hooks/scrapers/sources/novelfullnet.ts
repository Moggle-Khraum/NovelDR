// hooks/scrapers/sources/novelfullnet.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
  extractByDepth,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "novelfull.net";

// Same junk-phrase filtering as the other NovelFull-family scrapers, kept
// self-contained here so this site can change without dragging them along.
//
// 2026 layout: the chapter text lives in div#chapter-content. It is scoped to
// that block so page chrome (comment rules, login popup, report box, reader
// tips) is never picked up. The old layout and the regression fixtures have
// no such wrapper, so those fall back to every <p> on the page.
export const extractNovelFullContent = (html: string): string => {
  const junkPhrases = [
    "we are offering free books",
    "read novel updated daily",
    "light novel translations",
    "web novel, chinese novel",
    "japanese novel, korean novel",
    "other novel online",
    "novelfull.com",
    "readnovelfull.com",
    "allnovel.org",
    "novgo.net",
    "novelfull.net",
  ];

  const scope = extractByDepth(html, 'id="chapter-content"') ?? html;
  const pMatches = scope.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (!pMatches) return "";

  const valid: string[] = [];
  for (const p of pMatches) {
    let text = stripTags(p);
    text = decodeEntities(text);
    const lower = text.toLowerCase();
    if (
      text.length > 5 &&
      !junkPhrases.some((phrase) => lower.includes(phrase)) &&
      !lower.includes("next chapter") &&
      !lower.includes("previous chapter") &&
      !lower.includes("back to") &&
      !lower.includes("table of contents")
    ) {
      valid.push(text);
    }
  }
  return valid.join("\n\n");
};

// The first paragraph of the 2026 chapter body repeats the heading, usually
// doubled ("Chapter 1: Chapter 1: Title"). Drop it when it is just that.
const dropLeadingTitle = (content: string, heading: string): string => {
  if (!content || !heading) return content;
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const parts = content.split("\n\n");
  const first = norm(parts[0]);
  const wanted = norm(heading);
  if (
    wanted &&
    first.startsWith("chapter") &&
    first.endsWith(wanted) &&
    first.length <= wanted.length + 20
  ) {
    return parts.slice(1).join("\n\n");
  }
  return content;
};

export const novelFullNetScraper: SourceScraper = {
  id: "novelfullnet",
  name: "NovelFull.net",
  canHandle: (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === BASE_HOST || host.endsWith(`.${BASE_HOST}`);
    } catch {
      return false;
    }
  },
  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    // 2026 layout: <h1 class="tit">Title</h1> inside div.m-desc.
    let title = "Unknown Title";
    const ogTitle = safeMatch(
      html,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
    );
    const titleMatch =
      safeMatch(
        html,
        /<h1[^>]*class="[^"]*\btit\b[^"]*"[^>]*>([^<]+)<\/h1>/i,
      ) ||
      (ogTitle ? ogTitle.replace(/\s+-\s+NovelFull\s*$/i, "") : null) ||
      safeMatch(html, /<h3[^>]*class="title"[^>]*>([^<]+)<\/h3>/i) ||
      safeMatch(html, /<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/i) ||
      safeMatch(html, /<div[^>]*class="book-title"[^>]*>([^<]+)<\/div>/i);
    if (titleMatch) title = decodeEntities(titleMatch).trim();

    // 2026 layout: <a href="/author/Name" class="a1">Name</a>
    let author = "Unknown Author";
    const authorMatch =
      safeMatch(
        html,
        /<a[^>]*href="[^"]*\/author\/[^"]*"[^>]*>([^<]+)<\/a>/i,
      ) ||
      safeMatch(
        html,
        /<div[^>]*class="info"[^>]*>[\s\S]*?<h3>Author:<\/h3>\s*<a[^>]*>([^<]+)<\/a>/i,
      );
    if (authorMatch) author = decodeEntities(authorMatch).trim();

    // 2026 layout: <div id="novel-summary-inner"><p>...</p>...</div>
    let synopsis = "No summary available.";
    const descBlock =
      extractByDepth(html, 'id="novel-summary-inner"') ??
      safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
    if (descBlock) {
      const paragraphs = descBlock.match(/<p[^>]*>[\s\S]*?<\/p>/gi);
      const text = paragraphs
        ? paragraphs
            .map((p) => decodeEntities(stripTags(p)))
            .filter(Boolean)
            .join("\n\n")
        : decodeEntities(stripTags(descBlock));
      if (text) synopsis = text;
    }

    // 2026 layout: <div class="pic"><img src="/uploads/thumbs/..."></div>
    let coverUrl = "";
    const coverMatch =
      safeMatch(html, /<div[^>]*class="pic"[^>]*>\s*<img[^>]*src="([^"]+)"/i) ||
      safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ||
      safeMatch(
        html,
        /<div[^>]*class="book"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i,
      );
    if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);

    // 2026 layout: the "Read first" button, else the first row of the chapter
    // list (ul#idData inside div#list-chapter).
    let firstChapterUrl: string | null = null;
    const chapterMatch =
      safeMatch(
        html,
        /<a[^>]*href="([^"]+)"[^>]*>\s*<span[^>]*glyphicon-circle-arrow-right[^>]*>\s*<\/span>\s*Read first/i,
      ) ||
      safeMatch(
        html,
        /<(?:div|ul)[^>]*(?:id="(?:idData|list-chapter|tab-chapters)"|class="list-chapter")[^>]*>[\s\S]*?<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i,
      );
    if (chapterMatch) {
      firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
    } else {
      const chapterLinkMatch = safeMatch(
        html,
        /<a[^>]*href="([^"]*chapter[-/]1[^"]*)"[^>]*>/i,
      );
      if (chapterLinkMatch)
        firstChapterUrl = makeAbsoluteUrl(chapterLinkMatch, url);
    }

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: novelfullnet"],
    };
  },
  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    let title = `Chapter ${chapterNum}`;
    // 2026 layout: <span class="chapter-heading-text">Chapter 1: Title</span>
    const titleMatch =
      safeMatch(
        html,
        /<span[^>]*class="chapter-heading-text"[^>]*>([^<]+)<\/span>/i,
      ) ||
      safeMatch(
        html,
        /<span[^>]*class="(?:chr-text|chapter-text)"[^>]*>([^<]+)<\/span>/i,
      ) ||
      safeMatch(
        html,
        /<a[^>]*class="(?:chr-title|chapter-title)"[^>]*title="([^"]+)"/i,
      ) ||
      safeMatch(
        html,
        /<(?:h2|h3)[^>]*class="(?:chapter-title|title|chapter)"[^>]*>([^<]+)<\/(?:h2|h3)>/i,
      ) ||
      safeMatch(html, /<(?:h2|h3)[^>]*>([^<]*Chapter[^<]*)<\/(?:h2|h3)>/i);
    let headingText = "";
    if (titleMatch) {
      let rawTitle = decodeEntities(titleMatch.trim())
        .replace(/\s+/g, " ")
        .trim();
      headingText = rawTitle;
      // The site often numbers chapters twice: "Chapter 20 - 19: Title".
      rawTitle = rawTitle
        .replace(/^.*?Chapter\s+\d+\s+[-–—]\s+\d+\s*[:.]\s*/i, "")
        .replace(/^.*Chapter\s+\d+(\s+\d+)?\s*[:.\-–—]?\s*/i, "")
        .trim();
      rawTitle = rawTitle.replace(/^[\s,]+/, "").trim();
      title = `Chapter ${chapterNum}: ${rawTitle}`;
    }

    let content = dropLeadingTitle(extractNovelFullContent(html), headingText);
    if (!content) {
      const genericMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gis);
      if (genericMatch) {
        const texts = genericMatch
          .map((p) => decodeEntities(stripTags(p)))
          .filter((t) => t.length > 5);
        content = texts.join("\n\n");
      }
    }

    let nextUrl: string | null = null;
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
      const isNextNav = /data-nav=["']next["']/i.test(attrsStr);

      if (
        (isNextNav ||
          txt.includes("next") ||
          txt.includes("next chapter") ||
          attrs.includes("next") ||
          attrs.includes("next_chapter")) &&
        href
      ) {
        const isPlaceholder =
          !href || href === "#" || href.trim() === "" || !isSafeHref(href);
        const resolved = isPlaceholder ? null : makeAbsoluteUrl(href, url);
        const isSelfReference =
          resolved !== null &&
          normalizeForCompare(resolved) === currentPageNormalized;

        if (!isPlaceholder && !isSelfReference && resolved) {
          nextUrl = resolved;
          break;
        }
      }
    }

    return {
      url,
      title,
      content: content || "No content available.",
      nextUrl,
    };
  },
};
