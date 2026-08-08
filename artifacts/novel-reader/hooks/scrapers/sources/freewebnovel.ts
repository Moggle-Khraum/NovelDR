// hooks/scrapers/sources/freewebnovel.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "freewebnovel";

export const freeWebNovelScraper: SourceScraper = {
  id: "freewebnovel",
  name: "FreeWebNovel",
  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.toLowerCase().includes(BASE_HOST);
    } catch {
      return false;
    }
  },
  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url, { proxyFirst: true });

    let title = "Unknown Title";
    const titleMatch = safeMatch(
      html,
      /<h1[^>]*class="tit"[^>]*>([^<]+)<\/h1>/i,
    );
    if (titleMatch) title = decodeEntities(titleMatch);

    let author = "Unknown Author";
    const authorMatch = safeMatch(
      html,
      /<div[^>]*class="item"[^>]*>[\s\S]*?<div[^>]*class="right"[^>]*>[\s\S]*?<a[^>]*class="a1"[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) author = decodeEntities(authorMatch);

    let synopsis = "No summary available.";
    const innerMatch = safeMatch(
      html,
      /<div[^>]*class="inner"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (innerMatch) {
      const paragraphs = innerMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (paragraphs) {
        synopsis = paragraphs
          .map((p) => decodeEntities(stripTags(p)))
          .filter((t) => t.length > 0)
          .join("\n\n");
      }
    }

    let coverUrl = "";
    const coverMatch = safeMatch(
      html,
      /<div[^>]*class="pic"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i,
    );
    if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);

    let firstChapterUrl: string | null = null;
    let baseNovelUrl = url.replace(/\/$/, "");
    if (baseNovelUrl.includes("/chapter-")) {
      baseNovelUrl = baseNovelUrl.split("/chapter-")[0];
    }
    firstChapterUrl = `${baseNovelUrl}/chapter-1`;

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: freewebnovel"],
    };
  },
  fetchChapter: async (
    url: string,
    chapterNum: number,
  ): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url, { proxyFirst: true });

    let title = `Chapter ${chapterNum}`;
    const titleMatch =
      safeMatch(html, /<h1[^>]*class="tit"[^>]*>([^<]+)<\/h1>/i) ||
      safeMatch(html, /<h4[^>]*>([^<]*Chapter[^<]*)<\/h4>/i) ||
      safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
    if (titleMatch) {
      let rawTitle = decodeEntities(titleMatch.trim())
        .replace(/\s+/g, " ")
        .trim();
      rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]\s*/gi, "").trim();
      rawTitle = rawTitle
        .replace(new RegExp(`^\\s*${chapterNum}\\s*[:.\\-–—]?\\s*`, "i"), "")
        .trim();
      title = `Chapter ${chapterNum}: ${rawTitle}`;
    }

    let content = "";
    const junkPhrases = [
      "panda",
      "novɐ1",
      "com",
      "freewebnovel.com",
      "freewebnovel",
      "𝕗𝚛𝚎𝚎𝐰𝗲𝗯𝗻𝚘𝚟𝚎𝗹.𝕔𝐨𝕞",
      "please visit",
      "for a better experience",
      "click here",
      "download the app",
      "read latest chapters",
      "follow on",
      "facebook",
      "twitter",
      "instagram",
      "discord",
      "support the author",
      "donate",
      "patreon",
    ];

    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    if (pMatches) {
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
      content = valid.join("\n\n");
    }

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
