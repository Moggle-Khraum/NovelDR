// ── Source language registry ───────────────────────────────────────────────
// Tells the library card whether a novel comes from an English site or a
// machine-translated (MTL) site. Shown as a small pill beside the status tag.
//
// Keys are hostnames without "www.". Values are "en" (English translated),
// "mtl" (machine translated), or "etc" (any other language, e.g. Spanish). A site that is not listed simply
// shows no language pill.
//
// ── TEMPLATE: adding a new source ──────────────────────────────────────────
// 1. Add one line below with the site's hostname and its language:
//      "newsite.com": "en",    // English site
//      "newsite2.net": "mtl",  // machine-translated site
// 2. Keep the entry in the same place as its group (EN or MTL) for easy review.
// 3. If the site has a scraper, also add it to hooks/scrapers/registry.ts and
//    to getSourceDisplayName in app/(tabs)/index.tsx.
// ───────────────────────────────────────────────────────────────────────────

export type SourceLanguage = "en" | "mtl" | "etc";

const SOURCE_LANGUAGE: Record<string, SourceLanguage> = {
  // English sites
  "freewebnovel.com": "en",
  "freewebnovel.org": "en",
  "bednovel.com": "en",
  "readnovelfull.com": "en",
  "novelfull.com": "en",
  "novelfull.net": "en",
  "novgo.net": "en",
  "royalroad.com": "en",
  "wuxiaworld.site": "en",
  "novelphoenix.com": "en",
  "novelarrow.com": "en",
  "novel-bin.com": "en",
  "novelbin.cc": "en",
  "novelarchive.st": "en",
  "novelping.com": "en",
  "asianovel.net": "en",
  "wuxia.click": "en",
  "wuxiabox.com": "en",
  "lightnovel.to": "en",
  "novelbuddy.me": "en",
  "lightnovelworld.net": "en",

  // Machine-translated (MTL) sites
  "mtlnovel.me": "mtl",
  "fanmtl.com": "mtl",
  "mtl-novel.com": "mtl",
  "ranovel.com": "mtl",
  "jaomix.ru": "etc", // Russian
  "lightnovelvf.com": "etc", // French

  // Other languages (neither English nor MTL)
  "centralnovel.com": "etc", // Portuguese
  "novelasligeras.net": "etc", // Spanish (NovelasLigera / NOVA)
  "novelasligera.com": "etc", // Spanish (older domain)
  "meionovels.com": "etc", // Indonesian
};

// Optional flag shown beside the pill for "etc" (other-language) sites.
// Add one line per site, e.g. "newsite.es": "🇪🇸".
const SOURCE_FLAG: Record<string, string> = {
  "centralnovel.com": "🇧🇷", // Portuguese (Brazil)
  "novelasligeras.net": "🇪🇸", // Spanish
  "novelasligera.com": "🇪🇸", // Spanish (older domain)
  "meionovels.com": "🇮🇩", // Indonesian
  "jaomix.ru": "🇷🇺", // Russian
  "lightnovelvf.com": "🇫🇷", // French
};

/** Returns the flag emoji for a saved source URL, or null if the site has none. */
export const getSourceFlag = (sourceUrl: string): string | null => {
  try {
    const host = new URL(sourceUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return SOURCE_FLAG[host] ?? null;
  } catch {
    return null;
  }
};

/** Returns the language for a saved source URL, or null if the site is not listed. */
export const getSourceLanguage = (sourceUrl: string): SourceLanguage | null => {
  try {
    const host = new URL(sourceUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return SOURCE_LANGUAGE[host] ?? null;
  } catch {
    return null;
  }
};
