// hooks/scrapers/sources/wuxiaworld.ts
import type { SourceScraper, NovelMeta, ChapterData } from "../types";
import { fetchHtmlWithFallback, httpClient } from "../shared/http";
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
} from "../shared/html";
import { isSafeHref } from "../shared/urlSafety";

const BASE_HOST = "wuxiaworld.site";

// Copy helpers verbatim from useDirectScraper.ts
const cleanSynopsis = (text: string): string => {
  if (!text) return "";

  let cleaned = text;

  cleaned = cleaned.replace(
    /you\s*'?\s*re\s+reading[\s\S]{0,150}?on\s*wuxiaworld(?:\.?site)?/gi,
    "",
  );
  cleaned = cleaned.replace(
    /you\s+are\s+reading[\s\S]{0,150}?on\s*wuxiaworld(?:\.?site)?/gi,
    "",
  );

  const lines = cleaned.split(/\n/);
  const filteredLines = lines.filter((line) => {
    const lower = line.toLowerCase().trim();
    if (!lower) return true;
    if (/^you\s*'?\s*re\s+reading\s*:?\s*$/.test(lower)) return false;
    if (/^you\s+are\s+reading\s*:?\s*$/.test(lower)) return false;
    if (/^on\s*wuxiaworld(?:\.?site)?\s*$/.test(lower)) return false;
    if (/^["“][^"”]+["”]\s*$/.test(line.trim())) return false;
    return true;
  });

  cleaned = filteredLines.join("\n");
  cleaned = cleaned.replace(/wuxiaworld\.?site/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]+/g, " ").trim();
  cleaned = groupSentencesIntoParagraphs(cleaned);
  return cleaned || text;
};

const groupSentencesIntoParagraphs = (text: string): string => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:['"”’]\s*)?/g);
  if (!sentences || sentences.length <= 1) return text;

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];
  let sentenceCount = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    currentParagraph.push(trimmed);
    sentenceCount++;
    if (sentenceCount >= 3 || trimmed.length < 50) {
      paragraphs.push(currentParagraph.join(" "));
      currentParagraph = [];
      sentenceCount = 0;
    }
  }
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(" "));
  }
  return paragraphs.join("\n\n");
};

export const extractWuxiaworldContent = (html: string): string => {
  let content = "";
  const contentMatch1 = safeMatch(
    html,
    /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contentMatch2 = safeMatch(
    html,
    /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contentMatch3 = safeMatch(
    html,
    /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contentMatch4 = safeMatch(
    html,
    /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contentMatch5 = safeMatch(
    html,
    /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contentMatch6 = safeMatch(
    html,
    /<article[^>]*class="chapter"[^>]*>([\s\S]*?)<\/article>/i,
  );
  const contentHtml =
    contentMatch1 ||
    contentMatch2 ||
    contentMatch3 ||
    contentMatch4 ||
    contentMatch5 ||
    contentMatch6;

  if (contentHtml) {
    const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    if (paragraphs) {
      const cleanedParagraphs = paragraphs
        .map((p) => {
          let text = p.replace(/<p[^>]*>/i, "").replace(/<\/p>/i, "");
          text = text.replace(/<br\s*\/?>/gi, "\n\n");
          text = decodeEntities(text);
          text = stripTags(text);
          return text.trim();
        })
        .filter((t) => t.length > 0);
      content = cleanedParagraphs.join("\n\n");
    } else {
      let text = decodeEntities(stripTags(contentHtml));
      text = text.replace(/<br\s*\/?>/gi, "\n\n");
      content = text;
    }
  }
  return content;
};

export const wuxiaworldScraper: SourceScraper = {
  id: "wuxiaworld",
  name: "WuxiaWorld.site",
  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.toLowerCase().includes(BASE_HOST);
    } catch {
      return false;
    }
  },
  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    let title = "Unknown Title";
    const titleMatch = safeMatch(
      html,
      /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (titleMatch) title = decodeEntities(stripTags(titleMatch));

    let author = "Unknown Author";
    const authorMatch = safeMatch(
      html,
      /<div[^>]*class="author-content"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) author = decodeEntities(authorMatch);

    let synopsis = "No summary available.";
    let descMatch = safeMatch(
      html,
      /<div[^>]*class="description-summary"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (!descMatch) {
      descMatch = safeMatch(
        html,
        /<div[^>]*class="summary_content show-more[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
    }
    if (!descMatch) {
      descMatch = safeMatch(
        html,
        /<div[^>]*class="[^"]*summary_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
    }

    if (descMatch) {
      let summaryHtml = descMatch;
      summaryHtml = summaryHtml.replace(
        /<b>\s*<em>[\s\S]*?<\/em>\s*<\/b>/gi,
        "",
      );
      summaryHtml = summaryHtml.replace(
        /<em>\s*<b>[\s\S]*?<\/b>\s*<\/em>/gi,
        "",
      );

      const paragraphs = summaryHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (paragraphs) {
        const cleanedParagraphs = paragraphs
          .map((p) => {
            let text = p.replace(/<p[^>]*>/i, "").replace(/<\/p>/i, "");
            text = text.replace(/(?:<br\s*\/?>\s*){2,}/gi, "\n\n");
            text = text.replace(/<br\s*\/?>/gi, " ");
            text = decodeEntities(text);
            text = stripTags(text);
            return text
              .split("\n\n")
              .map((para) => para.replace(/\s+/g, " ").trim())
              .filter((para) => para.length > 0)
              .join("\n\n");
          })
          .filter((t) => t.length > 0);
        let fullText = cleanedParagraphs.join("\n\n");
        synopsis = cleanSynopsis(fullText);
      } else {
        let fallbackText = summaryHtml.replace(/<br\s*\/?>/gi, " ");
        fallbackText = decodeEntities(stripTags(fallbackText));
        fallbackText = fallbackText.replace(/\s+/g, " ").trim();
        synopsis = cleanSynopsis(fallbackText);
      }
    }

    let coverUrl = "";
    const coverMatch =
      safeMatch(
        html,
        /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*data-src="([^"]+)"/i,
      ) ||
      safeMatch(
        html,
        /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i,
      );
    if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);

    let firstChapterUrl: string | null = null;
    const mangaIdMatch =
      safeMatch(html, /var\s+manga\s*=\s*\{[^}]*"manga_id"\s*:\s*"(\d+)"/i) ||
      safeMatch(html, /"manga_id"\s*:\s*"(\d+)"/i);
    if (mangaIdMatch) {
      try {
        const ajaxUrl = "https://wuxiaworld.site/wp-admin/admin-ajax.php";
        const formData = new URLSearchParams();
        formData.append("action", "manga_get_chapters");
        formData.append("manga_id", mangaIdMatch);

        const ajaxResponse = await httpClient.post(ajaxUrl, formData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        const chapterHtml = ajaxResponse.data;
        const chapterMatch = safeMatch(
          chapterHtml,
          /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i,
        );
        if (chapterMatch) {
          firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
        }
      } catch (ajaxError: any) {
        const baseNovelUrl = url.replace(/\/$/, "");
        firstChapterUrl = `${baseNovelUrl}/chapter-1/`;
      }
    }

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ["fetched via external scraper: wuxiaworld"],
    };
  },
  fetchChapter: async (url: string, chapterNum: number): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    let title = `Chapter ${chapterNum}`;
    const titleMatch =
      safeMatch(html, /<h1[^>]*class="post-title"[^>]*>([\s\S]*?)<\/h1>/i) ||
      safeMatch(html, /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i) ||
      safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i) ||
      safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i);
    if (titleMatch) {
      let rawTitle = decodeEntities(stripTags(titleMatch))
        .trim()
        .replace(/\s+/g, " ")
        .trim();
      rawTitle = rawTitle
        .replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, "")
        .trim();
      title = `Chapter ${chapterNum}: ${rawTitle}`;
    }

    const content = extractWuxiaworldContent(html);

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
        const isPlaceholder = !href || href === "#" || href.trim() === "" || !isSafeHref(href);
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
