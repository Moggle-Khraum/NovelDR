// artifacts/novel-reader/hooks/scrapers/sources/allnovel.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";

const BASE_HOST = "allnovel.org";

const extractNovelFullContent = (html: string): string => {
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
  ];

  const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
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

export const allNovelScraper: SourceScraper = {
  id: "allnovel",
  name: "AllNovel",
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
    const titleMatch =
      safeMatch(html, /<h3[^>]*class="title"[^>]*>([^<]+)<\/h3>/i) ||
      safeMatch(html, /<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/i) ||
      safeMatch(html, /<div[^>]*class="book-title"[^>]*>([^<]+)<\/div>/i);
    if (titleMatch) title = decodeEntities(titleMatch);

    let author = "Unknown Author";
    const authorMatch = safeMatch(
      html,
      /<div[^>]*class="info"[^>]*>[\s\S]*?<h3>Author:<\/h3>\s*<a[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) author = decodeEntities(authorMatch);

    let synopsis = "No summary available.";
    const descMatch = safeMatch(
      html,
      /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (descMatch) {
      const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs) {
        const cleanedParagraphs = [];
        for (const p of paragraphs) {
          let text = p.replace(/<\/?p[^>]*>/gi, "");
          text = decodeEntities(stripTags(text));
          if (text.trim()) cleanedParagraphs.push(text.trim());
        }
        synopsis = cleanedParagraphs.join("\n\n");
      } else {
        synopsis = decodeEntities(stripTags(descMatch));
      }
    }

    let coverUrl = "";
    const coverMatch = safeMatch(
      html,
      /<div[^>]*class="book"[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*>/i,
    );
    if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);

    let firstChapterUrl: string | null = null;
    const chapterMatch = safeMatch(
      html,
      /<(?:div|ul)[^>]*(?:id="(?:tab-chapters|list-chapter)"|class="list-chapter")[^>]*>.*?<li[^>]*>.*?<a[^>]*href="([^"]+)"/i,
    );
    if (chapterMatch) {
      firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
    } else {
      const chapterLinkMatch = safeMatch(
        html,
        /<a[^>]*href="([^"]*chapter[-/]1[^"]*)"[^>]*>/i,
      );
      if (chapterLinkMatch) firstChapterUrl = makeAbsoluteUrl(chapterLinkMatch, url);
    }

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: allnovel"],
    };
  },
  fetchChapter: async (url: string, chapterNum: number): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    let title = `Chapter ${chapterNum}`;
    const titleMatch =
      safeMatch(html, /<span[^>]*class="(?:chr-text|chapter-text)"[^>]*>([^<]+)<\/span>/i) ||
      safeMatch(html, /<a[^>]*class="(?:chr-title|chapter-title)"[^>]*title="([^"]+)"/i) ||
      safeMatch(html, /<(?:h2|h3)[^>]*class="(?:chapter-title|title|chapter)"[^>]*>([^<]+)<\/(?:h2|h3)>/i) ||
      safeMatch(html, /<(?:h2|h3)[^>]*>([^<]*Chapter[^<]*)<\/(?:h2|h3)>/i);
    if (titleMatch) {
      let rawTitle = decodeEntities(titleMatch.trim())
        .replace(/\s+/g, " ")
        .trim();
      rawTitle = rawTitle
        .replace(/^.*Chapter\s+\d+(\s+\d+)?\s*[:.\-–—]?\s*/i, "")
        .trim();
      rawTitle = rawTitle.replace(/^[\s,]+/, "").trim();
      title = `Chapter ${chapterNum}: ${rawTitle}`;
    }

    let content = extractNovelFullContent(html);
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
