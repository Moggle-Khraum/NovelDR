// Pure helpers used by lib/updateEngine.ts. No React Native imports, so they
// can be unit tested under plain Node (scripts/test-engine-helpers.ts).
import type { Novel, Chapter } from "@/context/LibraryContext";
import { parseChapterNumber } from "./chapterOrder";

// ─── Extract chapter number from title ──────────────────────────────────────
// Shared parser (digits and Roman numerals). 0 when the title has no number.
export const extractChapterNumber = (title: string): number =>
  parseChapterNumber(title) ?? 0;

// ─── Determine next Start Chapter from saved chapters ───────────────────────
export const getNextStartChapter = (novel: Novel): number => {
  if (novel.chapters.length === 0) return 1;
  const lastChapter = novel.chapters[novel.chapters.length - 1];
  const lastNum = extractChapterNumber(lastChapter.title);
  return lastNum > 0 ? lastNum + 1 : novel.chapters.length + 1;
};

// ─── Chapter exists check (by URL) ──────────────────────────────────────────
export const chapterExists = (
  url: string,
  existingChapters: Chapter[],
): boolean => existingChapters.some((c) => c.url === url);

// ─── Direct URL skip for predictable chapter URL patterns ───────────────────
const isLightNovelWorld = (url: string): boolean =>
  url.toLowerCase().includes("lightnovelworld.org");

// AsiaNovel chapter URLs (.../chapter/chapter-773154/) LOOK like they'd
// match the generic chapter-N patterns below, but the number is an opaque
// internal post ID, NOT a sequential chapter number — substituting the
// target chapter number in produces a URL that doesn't exist. AsiaNovel's
// WordPress theme returns a soft-404 (HTTP 200, "Page Not Found" body) for
// those, so the guess doesn't even throw — it silently scrapes garbage
// (e.g. a chapter literally titled "404") instead of failing loudly.
const isAsianovel = (url: string): boolean =>
  url.toLowerCase().includes("asianovel.net");

const CHAPTER_SKIP_PATTERNS: { regex: RegExp }[] = [
  { regex: /(\/chapter-)(\d+)(\.html)$/ },
  { regex: /(\/chapter-)(\d+)(\/?)$/ },
  { regex: /(_chapter_)(\d+)()$/ },
];

const LNW_SKIP_PATTERNS: { regex: RegExp }[] = [
  { regex: /(\/chapter\/)(\d+)(\/?)$/ },
  { regex: /(chapter[-_]?)(\d+)()/i },
];

export const tryDirectSkip = (
  firstChapterUrl: string,
  targetChapter: number,
): string | null => {
  if (isAsianovel(firstChapterUrl)) {
    // No reliable way to guess a chapter's real URL from a target chapter
    // number on this site — always fall back to the sequential crawl,
    // which correctly walks the real chapter-index list instead.
    return null;
  }

  if (isLightNovelWorld(firstChapterUrl)) {
    for (const { regex } of LNW_SKIP_PATTERNS) {
      if (regex.test(firstChapterUrl)) {
        return firstChapterUrl.replace(
          regex,
          (_m: string, prefix: string, _num: string, suffix: string) =>
            `${prefix}${targetChapter}${suffix}`,
        );
      }
    }
    // Last resort for LNW only: bare trailing-number replace.
    if (/chapter/i.test(firstChapterUrl)) {
      const slashPattern = /\/(\d+)(\/?)$/;
      if (slashPattern.test(firstChapterUrl)) {
        return firstChapterUrl.replace(
          slashPattern,
          (_m: string, _num: string, trailingSlash: string) =>
            `/${targetChapter}${trailingSlash}`,
        );
      }
    }
    return null;
  }

  // Non-LNW sources: only the narrow, exact-suffix patterns.
  for (const { regex } of CHAPTER_SKIP_PATTERNS) {
    if (regex.test(firstChapterUrl)) {
      return firstChapterUrl.replace(
        regex,
        (_m: string, prefix: string, _num: string, suffix: string) =>
          `${prefix}${targetChapter}${suffix}`,
      );
    }
  }
  return null;
};

export const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
