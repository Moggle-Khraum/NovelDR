// Chapter-title search.
//
// Matching rules:
// - Case-insensitive, Unicode-aware (e.g. "cafe" does not match "Café", but
//   "café" does; accents are compared exactly).
// - Every search term must match. "chapter storm" needs both words.
// - A text term matches the start of any word in the title, so "chap" finds
//   "Chapter 3" and "stor" finds "The Storm".
// - A number term matches a whole number only. "1" finds "Chapter 1" and not
//   "Chapter 10" or "Chapter 1.5". "1.5" finds "Chapter 1.5" only.
// - Empty or punctuation-only queries match every chapter.

export type SearchableChapter = { title?: string };

// Splits a title into words. Dots stay inside a word so decimal numbers
// such as "1.5" remain whole.
function wordsOf(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[\s:,;!?()"'\u201C\u201D\u2018\u2019\-\u2013\u2014\[\]{}]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length > 0);
}

// ASCII punctuation, except the dot (which is part of decimal numbers).
// Written as an explicit class rather than Unicode property escapes, which
// older Hermes builds do not support.
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-/:;<=>?@\[\\\]^_`{|}~]/g;

// Query terms: lowercased, with characters other than letters, digits, and
// dots removed. Empty terms are dropped.
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(ASCII_PUNCTUATION, "").replace(/^\.+|\.+$/g, ""))
    .filter((term) => term.length > 0);
}

const NUMBER_TERM = /^\d+(\.\d+)?$/;

function termMatches(term: string, words: string[]): boolean {
  if (NUMBER_TERM.test(term)) {
    return words.some((word) => word === term);
  }
  return words.some((word) => word.startsWith(term));
}

export function filterChaptersByTitle<T extends SearchableChapter>(
  chapters: T[],
  query: string,
): T[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return chapters;

  return chapters.filter((chapter) => {
    const words = wordsOf(chapter.title ?? "");
    return terms.every((term) => termMatches(term, words));
  });
}
