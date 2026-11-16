// Registry of external (non-direct-scraper) sources.
// To add a new source: copy sources/exampleScraper.ts, implement it,
// then add it to REGISTERED_SCRAPERS below (order matters — first
// canHandle() match wins).

// artifacts/novel-reader/hooks/scrapers/registry.ts
import type { SourceScraper } from "./types";
import { novelPhoenixScraper } from "./sources/novelphoenix";
//import { novelArrowScraper } from "./sources/novelarrow";
import { novelBinScraper } from "./sources/novel-bin";
import { novelBinCcScraper } from "./sources/novelbincc";
import { novelPingScraper } from "./sources/novelping";
import { royalRoadScraper } from "./sources/royalroad";
import { readNovelFullScraper } from "./sources/readnovelfull";
import { novelFullComScraper } from "./sources/novelfullcom";
import { novelFullNetScraper } from "./sources/novelfullnet";
import { novgoScraper } from "./sources/novgo";
import { freeWebNovelScraper } from "./sources/freewebnovel";
import { wuxiaworldScraper } from "./sources/wuxiaworld";
import { novelArchiveStScraper } from "./sources/novelarchivest";
import { fanMtlScraper } from "./sources/fanmtl";
import { wuxiaBoxScraper } from "./sources/wuxiabox";
import { wuxiaClickScraper } from "./sources/wuxiaclick";
import { mtlNovelMeScraper } from "./sources/mtlnovelme";
import { lightNovelToScraper } from "./sources/lightnovelto";
import { novelBuddyScraper } from "./sources/novelbuddy";
import { centralNovelScraper } from "./sources/centralnovel";

const REGISTERED_SCRAPERS: SourceScraper[] = [
  novelPhoenixScraper,
  //novelArrowScraper,
  novelBinScraper,
  novelBinCcScraper,
  novelPingScraper,
  royalRoadScraper,
  readNovelFullScraper,
  novelFullComScraper,
  novelFullNetScraper,
  novgoScraper,
  freeWebNovelScraper,
  wuxiaworldScraper,
  novelArchiveStScraper,
  fanMtlScraper,
  wuxiaBoxScraper,
  wuxiaClickScraper,
  mtlNovelMeScraper,
  lightNovelToScraper,
  novelBuddyScraper,
  centralNovelScraper,
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
