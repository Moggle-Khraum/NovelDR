// Chapter numbering and reading order.
//
// Used by export, the Updates sync, and the chapter list so they all agree on
// order. Pure functions only (no React Native or filesystem imports), so they
// can be tested directly.

export type OrderableChapter = { title?: string; url?: string };

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
};

function intToRoman(value: number): string {
  const table: [number, string][] = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let out = "";
  for (const [amount, symbol] of table) {
    while (remaining >= amount) {
      out += symbol;
      remaining -= amount;
    }
  }
  return out;
}

// Accepts only canonical Roman numerals (round-trip check), so junk such as
// "IIII" or "VX" is not read as a chapter number.
export function romanToInt(text: string): number | null {
  const upper = text.toUpperCase();
  if (!/^[IVXLC]+$/.test(upper)) return null;
  let total = 0;
  let prev = 0;
  for (let i = upper.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[upper[i]];
    if (v < prev) {
      total -= v;
    } else {
      total += v;
      prev = v;
    }
  }
  return total > 0 && intToRoman(total) === upper ? total : null;
}

// Returns the chapter number written in a title, or null if there is none.
// Titles such as "Prologue", "Interlude", "Extra", and "Afterword" return null.
export function parseChapterNumber(title: string | undefined): number | null {
  const text = (title || "").trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /\bchapter\s+(\d+(?:\.\d+)?)\b/i,
    /\bch\.?\s*(\d+(?:\.\d+)?)\b/i,
    /#(\d+(?:\.\d+)?)/,
    /(\d+)(?:st|nd|rd|th)\s+chapter\b/i,
    /^(\d+(?:\.\d+)?)[\s\-:]/,
    // Chapter words used by the other languages we scrape.
    /(?:глава|розділ|chương|chapitre|capítulo|capitulo|bölüm|rozdział|rozdzial|bab)\s*(\d+(?:\.\d+)?)/i,
    /第\s*(\d+(?:\.\d+)?)\s*[章话回節节]/,
    /บท\s*(?:ที่\s*)?(\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseFloat(match[1]);
  }

  // Roman numeral after "Chapter", e.g. "Chapter V" or "Chapter IX: The Storm".
  const roman = text.match(/\bchapter\s+([IVXLC]+)\b/i);
  if (roman) {
    const value = romanToInt(roman[1]);
    if (value !== null) return value;
  }

  return null;
}

const PROLOGUE = /\bprologue\b/i;

// Front matter that always goes to the top, and back matter that always goes
// to the bottom, whatever their position in the list.
// Unicode-aware whole-word match, since \b does not work for Cyrillic or accents.
const wordMatch = (words: string[]) =>
  new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, "iu");
const FRONT_MATTER = wordMatch([
  "prologue", "introduction", "prolog", "пролог", "введение", "вступление",
  "prólogo", "prologo", "introducción", "introduccion", "prefacio", "prefácio",
]);
const BACK_MATTER = wordMatch([
  "epilogue", "afterword", "epílogo", "epilogo", "epilog", "эпилог",
  "послесловие", "posfácio", "posfacio", "postscript",
]);

// Orders chapters into reading order without changing their identity.
//
// - Numbered chapters are ordered by their number.
// - A prologue stays first.
// - Any other unnumbered chapter (interlude, extra, afterword, ...) keeps its
//   place relative to the numbered chapter before it in the given list. Such a
//   chapter is placed just after that number, so it stays where it was
//   downloaded instead of being moved to the front.
// - Ties keep the original list order (the sort is stable by position).
//
// Running this twice gives the same result as running it once.
export function orderChapters<T extends OrderableChapter>(chapters: T[]): T[] {
  let lastNumber: number | null = null;
  const keyed = chapters.map((chapter, index) => {
    const title = chapter.title || "";
    const number = parseChapterNumber(title);
    let key: number;
    if (BACK_MATTER.test(title)) {
      key = 1e9;
    } else if (FRONT_MATTER.test(title) || number === 0) {
      key = -1e9;
    } else if (number !== null) {
      key = number;
      lastNumber = number;
    } else if (PROLOGUE.test(title)) {
      key = -1e9;
    } else {
      key = (lastNumber ?? 0) + 0.5;
    }
    return { chapter, index, key };
  });

  keyed.sort((a, b) => a.key - b.key || a.index - b.index);
  return keyed.map((entry) => entry.chapter);
}
