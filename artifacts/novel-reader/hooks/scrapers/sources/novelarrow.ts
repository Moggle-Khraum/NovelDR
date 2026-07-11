// NovelArrow (novelarrow.com) — Next.js site.
// Confirmed against real page dumps: despite being a Next.js app, both the
// novel page's synopsis and the chapter page's content are plain SSR'd HTML
// (<article data-chapter-id="..."> full of ordinary <p> tags) — NOT RSC
// streaming payloads. No self.__next_f.push chunk parsing needed here.

import type { SourceScraper, NovelMeta, ChapterData } from '../types';
import { fetchHtmlWithFallback } from '../shared/http';
import { stripTags, decodeEntities, safeMatch, makeAbsoluteUrl, extractByDepth } from '../shared/html';

const BASE_HOST = 'novelarrow.com';

/** Extract every <p>...</p> from a block of HTML */
const extractParagraphs = (html: string): string => {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter(Boolean)
    .join('\n\n');
};

export const novelArrowScraper: SourceScraper = {
  id: 'novelarrow',
  name: 'NovelArrow',

  canHandle: (url: string) => {
    try {
      return new URL(url).hostname.includes(BASE_HOST);
    } catch {
      return false;
    }
  },

  fetchNovelMeta: async (url: string): Promise<NovelMeta> => {
    const html = await fetchHtmlWithFallback(url);

    // Confirmed against a real /novel/ page dump — the <head> carries custom
    // og:novel:* meta tags (name=, not property=) that are cleaner than the
    // generic og: tags (og:title has a "| Read Online on NovelArrow" suffix,
    // og:description is truncated with "...").
    const title = decodeEntities(
      safeMatch(html, /<meta[^>]*name="og:novel:novel_name"[^>]*content="([^"]+)"/i) ??
        safeMatch(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ??
        safeMatch(html, /<title>([^<]+)<\/title>/i) ??
        'Unknown Title',
    );

    const author = decodeEntities(
      safeMatch(html, /<meta[^>]*name="og:novel:author"[^>]*content="([^"]+)"/i) ??
        safeMatch(html, /<meta[^>]*name="author"[^>]*content="([^"]+)"/i) ??
        'Unknown Author',
    );

    const coverUrl = safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ?? '';

    // The synopsis is plain SSR'd HTML — lives in a div.site-reading-copy
    // block as ordinary <p> tags.
    const synopsisBlock = extractByDepth(html, 'class="site-reading-copy');
    let synopsis = synopsisBlock ? extractParagraphs(synopsisBlock) : '';

    // Fall back to the (truncated) og:description meta if the div wasn't found
    if (!synopsis) {
      const synopsisMeta = safeMatch(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      synopsis = synopsisMeta ? decodeEntities(synopsisMeta) : '';
    }

    // og:novel:read_url gives the first chapter link directly, already absolute
    const firstChapterUrl =
      safeMatch(html, /<meta[^>]*name="og:novel:read_url"[^>]*content="([^"]+)"/i) ??
      (() => {
        const firstChapterPath = safeMatch(html, /<a[^>]*href="(\/chapter\/[^"]+)"/i);
        return firstChapterPath ? makeAbsoluteUrl(firstChapterPath, url) : null;
      })();

    return {
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
      debugInfo: ['fetched via external scraper: novelarrow (og:novel:* meta tags)'],
    };
  },

  fetchChapter: async (url: string, _chapterNum: number): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);

    // Confirmed against a real /chapter/ page dump — chapter text is plain
    // SSR'd HTML inside <article data-chapter-id="...">, one <p> per line.
    const articleHtml = extractByDepth(html, 'data-chapter-id', '<article', '</article');
    if (!articleHtml) {
      throw new Error('novelarrow: could not locate <article data-chapter-id> block.');
    }

    const content = extractParagraphs(articleHtml);
    if (!content) {
      throw new Error('novelarrow: article block found but no <p> paragraphs extracted.');
    }

    // Title: og:novel:chapter_name meta is simplest and confirmed present;
    // falls back to the "hidden sm:inline" span inside the article's <h2>.
    const title = decodeEntities(
      safeMatch(html, /<meta[^>]*name="og:novel:chapter_name"[^>]*content="([^"]+)"/i) ??
        safeMatch(articleHtml, /<span class="hidden sm:inline">([^<]+)<\/span>/i) ??
        '',
    );

    // Next chapter: the desktop side-rail "Next chapter" link has a real href
    // when a next chapter exists; it's a disabled <span> (no href) on the
    // last chapter, so an absent match correctly yields null.
    const nextPath = safeMatch(html, /<a[^>]*aria-label="Next chapter"[^>]*href="([^"]+)"/i);
    const nextUrl = nextPath ? makeAbsoluteUrl(nextPath, url) : null;

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};
