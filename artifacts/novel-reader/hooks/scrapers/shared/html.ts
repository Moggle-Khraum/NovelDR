// Small, self-contained HTML helpers for external scrapers.
// Deliberately NOT imported from useDirectScraper.ts (which keeps its own
// private copies) so this layer never reaches into its internals and stays
// safe to evolve independently.

import { decodeHTML } from 'entities';

/** Strip HTML tags and collapse whitespace */
export const stripTags = (html: string): string => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
