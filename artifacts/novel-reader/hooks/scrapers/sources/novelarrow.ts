// NovelArrow (novelarrow.com) — Next.js site.
// IMPORTANT (re-confirmed against real /chapter/ and /novel/ page response
// dumps, 2026-07): BOTH page types ship NO server-rendered DOM whatsoever —
// no <html>, no <meta> tags, no <article>, nothing. Every response is a
// pure Next.js RSC flight payload (chunks like `25:T1a6e,<h4>Chapter 1...`
// and JSON-described elements like `["$","meta","13",{"name":"...",
// "content":"..."}]` in place of literal <meta> tags).
//
// Data is recovered via three complementary strategies:
//  1. extractMetaContent() — matches meta name/property + content whether
//     it's literal HTML or the JSON-described element form.
//  2. extractJsonValueAfterKey() — pulls balanced JSON array/object values
//     out of the payload by key, e.g. the novel page's full, untruncated
//     "synopsisParagraphs":[...] array.
//  3. extractFlightTChunks() — parses the raw "T" text segments (chapter
//     prose), looked up via the id a JSON blob points at, e.g.
//     "chapter_content":"$25".
// DOM-based paths (extractByDepth for <article>/site-reading-copy, literal
// <meta> regex) are kept as a first attempt / fallback in case some pages
// or future deployments do SSR real markup.

import type { SourceScraper, NovelMeta, ChapterData } from '../types';
import { fetchHtmlWithFallback } from '../shared/http';
import {
  stripTags,
  decodeEntities,
  safeMatch,
  makeAbsoluteUrl,
  extractByDepth,
  extractFlightTChunks,
  extractJsonValueAfterKey,
  extractNextFlightPayload,
} from '../shared/html';

const BASE_HOST = 'novelarrow.com';

/**
 * Extract a meta tag's content by name/property. Handles two formats:
 *  1. Literal HTML: <meta name="x" content="y">
 *  2. JSON-described React element (found inside RSC flight payloads,
 *     confirmed present on both /novel/ and /chapter/ pages):
 *     ["$","meta","13",{"name":"x","content":"y"}]
 * Tried in that order since format (1) is cheaper to match and may still
 * appear on some deployments/pages.
 */
const extractMetaContent = (html: string, key: string, flight?: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jsonPattern = new RegExp(`"(?:name|property)":"${escapedKey}","content":"([^"]+)"`, 'i');
  return (
    safeMatch(
      html,
      new RegExp(`<meta[^>]*(?:name|property)="${escapedKey}"[^>]*content="([^"]+)"`, 'i'),
    ) ??
    safeMatch(html, jsonPattern) ??
    (flight ? safeMatch(flight, jsonPattern) : null)
  );
};

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
    // The body's RSC data (synopsisParagraphs, chapter refs, etc.) ships
    // inside <script>self.__next_f.push([1,"..."])</script> as an escaped
    // JS string — real `<`/`"`/newlines only exist after de-escaping. <meta>
    // tags are still real SSR'd HTML, so those keep matching raw `html`.
    const flight = extractNextFlightPayload(html);

    // og:novel:* meta carries cleaner values than the generic og: tags
    // (og:title has a "| Read Online on NovelArrow" suffix, og:description
    // is truncated with "..."). Present as either literal <meta> HTML or a
    // JSON-described element depending on what the page ships — see
    // extractMetaContent above.
    const title = decodeEntities(
      extractMetaContent(html, 'og:novel:novel_name', flight) ??
        extractMetaContent(html, 'og:title', flight) ??
        safeMatch(html, /<title>([^<]+)<\/title>/i) ??
        'Unknown Title',
    );

    const author = decodeEntities(
      extractMetaContent(html, 'og:novel:author', flight) ??
        extractMetaContent(html, 'author', flight) ??
        'Unknown Author',
    );

    const coverUrl = extractMetaContent(html, 'og:image', flight) ?? '';

    // Re-confirmed against a real /novel/ page response dump (2026-07):
    // like chapter pages, novel pages ship NO server-rendered DOM at all —
    // no <html>, no site-reading-copy div, nothing. The FULL synopsis lives
    // as a plain inline JSON array in the flight payload:
    //   "synopsisParagraphs":["para one","———","\u201cdialogue\u201d",...]
    // Each element is already a complete paragraph (including scene-break
    // markers like "———"), so this is both more reliable AND untruncated
    // compared to og:description.
    let synopsis = '';
    const synopsisArrayJson = extractJsonValueAfterKey(flight, 'synopsisParagraphs');
    if (synopsisArrayJson) {
      try {
        const paragraphs = JSON.parse(synopsisArrayJson) as unknown;
        if (Array.isArray(paragraphs)) {
          synopsis = paragraphs
            .filter((p): p is string => typeof p === 'string')
            .map((p) => decodeEntities(p))
            .filter(Boolean)
            .join('\n\n');
        }
      } catch {
        // malformed JSON (shouldn't happen) — fall through to other paths
      }
    }

    // Fallback: some deployments may still SSR a div.site-reading-copy
    // block full of ordinary <p> tags.
    if (!synopsis) {
      const synopsisBlock = extractByDepth(html, 'class="site-reading-copy');
      if (synopsisBlock) synopsis = extractParagraphs(synopsisBlock);
    }

    // Further fallback: a generic "$<id>" reference into a raw flight text
    // chunk, in case the key name ever differs from synopsisParagraphs.
    if (!synopsis) {
      const refId = safeMatch(
        flight,
        /"(?:description|synopsis|novel_description|about)":"\$(\w+)"/i,
      );
      if (refId) {
        const tChunks = extractFlightTChunks(flight);
        const chunk = tChunks.get(refId);
        if (chunk) {
          synopsis = /<p[^>]*>/i.test(chunk)
            ? extractParagraphs(chunk)
            : decodeEntities(stripTags(chunk));
        }
      }
    }

    // Last resort: the (truncated, "...") og:description meta tag.
    if (!synopsis) {
      const synopsisMeta = extractMetaContent(html, 'og:description', flight);
      synopsis = synopsisMeta ? decodeEntities(synopsisMeta) : '';
    }

    // og:novel:read_url gives the first chapter link directly, already absolute
    const firstChapterUrl =
      extractMetaContent(html, 'og:novel:read_url', flight) ??
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
      debugInfo: [
        'fetched via external scraper: novelarrow (og:novel:* meta, synopsisParagraphs JSON)',
      ],
    };
  },

  fetchChapter: async (url: string, _chapterNum: number): Promise<ChapterData> => {
    const html = await fetchHtmlWithFallback(url);
    // Chapter content, chapter_name, and nextChapter all live in the body's
    // RSC flight data, shipped inside <script>self.__next_f.push([1,"..."])
    // as an escaped JS string (real `<`/`"`/newlines only exist once
    // de-escaped) — NOT as raw text in the fetched HTML. This de-escaped/
    // joined text is what actually needs to be searched.
    const flight = extractNextFlightPayload(html);

    // Try the DOM path first in case some chapters/deployments really do
    // SSR an <article data-chapter-id="..."> block.
    let articleHtml = extractByDepth(html, 'data-chapter-id', '<article', '</article');
    let title = '';
    let nextUrl: string | null = null;

    if (!articleHtml) {
      // Re-confirmed against a real response dump: chapter pages ship NO
      // DOM at all, only a Next.js RSC flight payload. It embeds a
      // `chapterInfo` JSON blob — e.g.
      //   "chapterInfo":{"chapter_name":"Chapter 1. The beginning.",
      //     "chapter_content":"$25",
      //     "nextChapter":{"chapter_id":"chapter-2-a-fixed-future",...}}
      // `"chapter_content":"$25"` points at flight chunk id "25", which
      // holds the actual chapter HTML (one <p> per line, no wrapper tag).
      const tChunks = extractFlightTChunks(flight);

      const contentRefId = safeMatch(flight, /"chapter_content":"\$(\w+)"/);
      articleHtml = contentRefId ? (tChunks.get(contentRefId) ?? null) : null;

      // Fallback if the JSON ref pattern isn't found: the content chunk is
      // the one starting with the chapter's <h4> heading.
      if (!articleHtml) {
        for (const chunk of tChunks.values()) {
          if (/^<h4[^>]*>/i.test(chunk) && /<p[^>]*>/i.test(chunk)) {
            articleHtml = chunk;
            break;
          }
        }
      }

      title = decodeEntities(safeMatch(flight, /"chapter_name":"([^"]+)"/) ?? '');

      // "nextChapter":null on the last chapter; otherwise a chapter_id we
      // can rebuild the URL from (chapter URLs are /chapter/<novelId>/<id>).
      const nextChapterId = safeMatch(flight, /"nextChapter":\{"chapter_id":"([^"]+)"/);
      if (nextChapterId) {
        const novelIdMatch = url.match(/\/chapter\/([^/]+)\//);
        if (novelIdMatch) {
          nextUrl = makeAbsoluteUrl(`/chapter/${novelIdMatch[1]}/${nextChapterId}`, url);
        }
      }
    }

    if (!articleHtml) {
      throw new Error(
        'novelarrow: could not locate chapter content (neither <article> DOM nor RSC flight chunk found).',
      );
    }

    const content = extractParagraphs(articleHtml);
    if (!content) {
      throw new Error('novelarrow: content block found but no <p> paragraphs extracted.');
    }

    // Title: og:novel:chapter_name meta is simplest when present; otherwise
    // fall back to whatever the DOM/flight-blob path above already found.
    if (!title) {
      title = decodeEntities(
        extractMetaContent(html, 'og:novel:chapter_name', flight) ??
          safeMatch(articleHtml, /<span class="hidden sm:inline">([^<]+)<\/span>/i) ??
          '',
      );
    }

    // Next chapter: the desktop side-rail "Next chapter" link has a real href
    // when a next chapter exists (DOM path only — the flight path above
    // already resolved this from the chapterInfo JSON).
    if (!nextUrl) {
      const nextPath = safeMatch(html, /<a[^>]*aria-label="Next chapter"[^>]*href="([^"]+)"/i);
      nextUrl = nextPath ? makeAbsoluteUrl(nextPath, url) : null;
    }

    return {
      url,
      title,
      content,
      nextUrl,
    };
  },
};

