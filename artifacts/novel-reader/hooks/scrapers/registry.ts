// Registry of external (non-direct-scraper) sources.
// To add a new source: copy sources/exampleScraper.ts, implement it,
// then add it to REGISTERED_SCRAPERS below (order matters — first
// canHandle() match wins).

// artifacts/novel-reader/hooks/scrapers/registry.ts
import type { SourceScraper } from "./types";
import { novelPhoenixScraper } from "./sources/novelphoenix";
import { novelArrowScraper } from "./sources/novelarrow";
import { novelBinScraper } from "./sources/novel-bin";
import { novelBinCcScraper } from "./sources/novelbincc";
import { royalRoadScraper } from "./sources/royalroad";
import { readNovelFullScraper } from "./sources/readnovelfull";
import { novelFullNetScraper } from "./sources/novelfullnet";
import { novelFullComScraper } from "./sources/novelfullcom";
import { allNovelScraper } from "./sources/allnovel";
import { novgoScraper } from "./sources/novgo";
import { freeWebNovelScraper } from "./sources/freewebnovel";
import { wuxiaworldScraper } from "./sources/wuxiaworld";

const REGISTERED_SCRAPERS: SourceScraper[] = [
  novelPhoenixScraper,
  novelArrowScraper,
  novelBinScraper,
  novelBinCcScraper,
  royalRoadScraper,
  readNovelFullScraper,
  novelFullNetScraper,
  novelFullComScraper,
  allNovelScraper,
  novgoScraper,
  freeWebNovelScraper,
  wuxiaworldScraper,
];

export const findExternalScraper = (url: string): SourceScraper | null => {
  for (const scraper of REGISTERED_SCRAPERS) {
    try {
      if (scraper.canHandle(url)) return scraper;
    } catch {
      continue;
    }
  }
  return null;
};
