// Small, self-contained HTML helpers for external scrapers.
// Deliberately NOT imported from useDirectScraper.ts (which keeps its own
// private copies) so this layer never reaches into its internals and stays
// safe to evolve independently.

import { decodeHTML } from 'entities';

/** Strip HTML tags and collapse whitespace */
export const stripTags = (html: string): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Decode HTML entities safely, e.g. &amp; -> & */
export const decodeEntities = (text: string): string => {
  if (!text) return '';
  try {
    return decodeHTML(text);
  } catch {
    return text;
  }
};

/** Safe regex match returning capture group 1, or null */
export const safeMatch = (text: string, pattern: RegExp): string | null => {
  if (!text) return null;
  try {
    const match = text.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

/** Resolve a possibly-relative URL against a base URL */
export const makeAbsoluteUrl = (relativeUrl: string, baseUrl: string): string => {
  if (!relativeUrl) return baseUrl;
  if (relativeUrl.startsWith('http')) return relativeUrl;
  if (relativeUrl.startsWith('/')) {
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

/**
 * Parse Next.js RSC "flight" payloads — the streaming format some Next.js
 * App Router sites ship instead of (or alongside) server-rendered HTML,
 * e.g. `25:T1a6e,<h4>Chapter 1...</h4><p>...`. Each "T" segment is a raw
 * text/HTML chunk prefixed by its id and a hex-encoded UTF-8 BYTE length
 * (not a character count — curly quotes, em dashes, etc. are multi-byte),
 * so segments are sliced via TextEncoder/TextDecoder rather than naive
 * string indexing to avoid truncating on non-ASCII content.
 *
 * Returns a Map from chunk id -> decoded text, so callers can look up a
 * specific chunk referenced elsewhere in the payload (e.g. a JSON field
 * like `"chapter_content":"$25"` points at chunk id "25").
 */
export const extractFlightTChunks = (raw: string): Map<string, string> => {
  const result = new Map<string, string>();
  if (!raw) return result;

  const marker = /(?:^|\n)([0-9a-zA-Z]+):T([0-9a-f]+),/g;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(raw)) !== null) {
    const id = match[1];
    const byteLen = parseInt(match[2], 16);
    const contentStart = match.index + match[0].length;
    const tail = raw.slice(contentStart);

    let content: string;
    try {
      const tailBytes = new TextEncoder().encode(tail);
      content = new TextDecoder().decode(tailBytes.slice(0, byteLen));
    } catch {
      // Fallback if TextEncoder/TextDecoder aren't available: approximate
      // with a character-based slice (only wrong for non-ASCII content).
      content = tail.slice(0, byteLen);
    }

    result.set(id, content);
  }

  return result;
};

/**
 * Find `"<key>":` in a blob of JSON/JS (e.g. inside a Next.js RSC flight
 * chunk) and return the raw text of the array or object value that follows
 * it, with brackets balanced and string literals correctly skipped over (so
 * literal `[`/`]`/`{`/`}` characters inside string values, e.g. dialogue
 * text, don't throw the depth count off). Returns null if the key isn't
 * found or its value isn't an array/object. Caller is expected to
 * JSON.parse() the result.
 */
export const extractJsonValueAfterKey = (raw: string, key: string): string | null => {
  const marker = `"${key}":`;
  const keyIndex = raw.indexOf(marker);
  if (keyIndex === -1) return null;

  let i = keyIndex + marker.length;
  while (i < raw.length && /\s/.test(raw[i])) i++;

  const openChar = raw[i];
  const closeChar = openChar === '[' ? ']' : openChar === '{' ? '}' : null;
  if (!closeChar) return null;

  const start = i;
  let depth = 0;
  let inString = false;

  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped character (handles \" correctly)
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
};

/**
 * De-escape and concatenate Next.js RSC flight payloads out of their
 * <script> wrappers. The flight data is NOT raw text in the document body —
 * it's shipped as a JS string literal inside inline scripts:
 *   self.__next_f.push([1,"25:T1a6e,\u003ch4\u003eChapter 1\u003c/h4\u003e..."])
 * Angle brackets (\u003c/\u003e), quotes (\"), and newlines (\n as two
 * chars) are all JS-string-escaped there. extractFlightTChunks and
 * extractJsonValueAfterKey both expect *real* `<`, `"`, and newline bytes —
 * so they must run against this de-escaped/joined text, not the raw fetched
 * HTML. (Real <meta> tags are the exception: Next.js still SSRs those into
 * the actual <head>, so meta extraction can keep matching raw `html`.)
 */
export const extractNextFlightPayload = (html: string): string => {
  if (!html) return '';
  const pushRe = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  const chunks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pushRe.exec(html)) !== null) {
    let content = match[1];
    try {
      // The captured text is itself the body of a JSON string literal, so
      // wrapping it back in quotes and JSON.parse-ing it is the correct/
      // complete unescape (handles \u003c, \", \n, \\, etc. all at once).
      content = JSON.parse(`"${content}"`);
    } catch {
      // Fallback for malformed/partial matches: hand-roll the common escapes.
      content = content
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/\\u0026/gi, '&')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    chunks.push(content);
  }

  // Joined with real newlines so extractFlightTChunks' (?:^|\n) anchor
  // matches between pushes just like it would between chunks in one push.
  return chunks.join('\n');
};

/** Extract the first inner text/HTML block between a start marker and its matching close tag by simple depth counting (for div-based selectors) */
export const extractByDepth = (
  html: string,
  startMarker: string,
  openTag = '<div',
  closeTag = '</div',
): string | null => {
  const start = html.indexOf(startMarker);
  if (start === -1) return null;

  const openTagEnd = html.indexOf('>', start);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let i = openTagEnd + 1;

  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(openTag, i);
    const nextClose = html.indexOf(closeTag, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      i = nextClose + closeTag.length;
    }
  }

  return html.slice(openTagEnd + 1, i);
};
