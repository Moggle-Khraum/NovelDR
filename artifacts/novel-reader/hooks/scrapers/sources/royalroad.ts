// hooks/scrapers/sources/royalroad.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "royalroad.com";

// Helper to extract paragraphs from a block of HTML, with standard filtering
export const extractContentParagraphs = (html: string): string => {
  const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (!pMatches) return "";

  const validParagraphs: string[] = [];
  for (const p of pMatches) {
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
  return validParagraphs.join("\n\n");
};

export const royalRoadScraper: SourceScraper = {
  id: "royalroad",
  name: "RoyalRoad",
  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.includes(BASE_HOST);
    } catch {
      return false;
    }
  },
  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    let title = "Unknown Title";
    let author = "Unknown Author";
    let synopsis = "No summary available.";
    let coverUrl = "";
    let firstChapterUrl: string | null = null;

    const titleMatch = safeMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i);
    if (titleMatch) title = decodeEntities(titleMatch);

    const authorMatch = safeMatch(
      html,
      /<h4[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) author = decodeEntities(authorMatch);

    const descMatch = safeMatch(
      html,
      /<div[^>]*class="description"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (descMatch) {
      const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (paragraphs) {
        synopsis = paragraphs
          .map((p) => decodeEntities(stripTags(p)))
          .filter((t) => t.length > 0)
          .join("\n\n");
      } else {
        synopsis = decodeEntities(stripTags(descMatch));
      }
    }

    const coverMatch =
      safeMatch(
        html,
        /<div[^>]*class="[^"]*cover-art-container[^"]*"[^>]*>[\s\S]*?<img[^>]*class="[^"]*thumbnail[^"]*"[^>]*src="([^"]+)"[^>]*>/i,
      ) ||
      safeMatch(
        html,
        /<img[^>]*class="[^"]*thumbnail[^"]*"[^>]*src="([^"]+)"[^>]*>/i,
      ) ||
      safeMatch(html, /<img[^>]*data-type="cover"[^>]*src="([^"]+)"[^>]*>/i) ||
      safeMatch(
        html,
        /<figure[^>]*class="[^"]*cover-art[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i,
      ) ||
      safeMatch(
        html,
        /<img[^>]*class="[^"]*cover[^"]*"[^>]*src="([^"]+)"[^>]*>/i,
      ) ||
      safeMatch(
        html,
        /<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i,
      ) ||
      safeMatch(
        html,
        /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"[^>]*>/i,
      );

    if (coverMatch) {
      coverUrl = makeAbsoluteUrl(coverMatch, url);
    }

    const chapterListMatch =
      safeMatch(
        html,
        /<table[^>]*class="chapters"[^>]*>([\s\S]*?)<\/table>/i,
      ) ||
      safeMatch(
        html,
        /<div[^>]*class="chapter-list"[^>]*>([\s\S]*?)<\/div>/i,
      ) ||
      safeMatch(html, /<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

    if (chapterListMatch) {
      const firstChapterMatch =
        safeMatch(
          chapterListMatch,
          /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i,
        ) ||
        safeMatch(
          chapterListMatch,
          /<a[^>]*href="([^"]*\/chapters[^"]*)"[^>]*>/i,
        );
      if (firstChapterMatch) {
        firstChapterUrl = makeAbsoluteUrl(firstChapterMatch, url);
      }
    }

    if (!firstChapterUrl) {
      const baseNovelUrl = url.replace(/\/$/, "");
      if (url.includes("/fiction/")) {
        const fictionIdMatch = url.match(/\/fiction\/(\d+)/i);
        if (fictionIdMatch) {
          firstChapterUrl = `${baseNovelUrl}/chapters/1`;
        }
      }
      if (!firstChapterUrl) {
        firstChapterUrl = `${baseNovelUrl}/chapter/1/`;
      }
    }

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: royalroad"],
    };
  },
  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    let title = `Chapter ${chapterNum}`;
    const titleMatch =
      safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
      safeMatch(html, /<h1[^>]*itemprop="headline"[^>]*>([^<]+)<\/h1>/i) ||
      safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i) ||
      safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i);
    if (titleMatch) {
      let rawTitle = decodeEntities(titleMatch.trim())
        .replace(/\s+/g, " ")
        .trim();
      rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, "").trim();
      title = `Chapter ${chapterNum}: ${rawTitle}`;
    }

    let content = extractContentParagraphs(html);

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

      if (
        (txt.includes("next") ||
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
