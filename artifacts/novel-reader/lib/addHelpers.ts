// Pure helpers used by lib/addEngine.ts. No React Native imports, so they
// can be unit tested under plain Node (scripts/test-engine-helpers.ts).
import { parseChapterNumber } from "./chapterOrder";

export const tryDirectSkip = (
  firstUrl: string,
  targetChapter: number,
): string | null => {
  const chapterPattern = /(chapter[-_]?)(\d+)/i;
  const match = firstUrl.match(chapterPattern);
  if (match) {
    const prefix = match[1];
    const newUrl = firstUrl.replace(
      chapterPattern,
      `${prefix}${targetChapter}`,
    );
    if (newUrl !== firstUrl) return newUrl;
  }

  const slashPattern = /\/(\d+)\//;
  const slashMatch = firstUrl.match(slashPattern);
  if (slashMatch) {
    const newUrl = firstUrl.replace(slashPattern, `/${targetChapter}/`);
    if (newUrl !== firstUrl) return newUrl;
  }

  return null;
};

export const extractChapterNumber = (title: string): number => {
  const shared = parseChapterNumber(title);
  if (shared !== null) return shared;
  const patterns = [
    /chapter\s+(\d+(?:\.\d+)?)/i,
    /ch\.?\s*(\d+(?:\.\d+)?)/i,
    /#(\d+(?:\.\d+)?)/,
    /(\d+)(?:st|nd|rd|th)\s+chapter/i,
    /^(\d+(?:\.\d+)?)[\s\-:]/,
    /volume\s+\d+\s+chapter\s+(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return 0;
};
