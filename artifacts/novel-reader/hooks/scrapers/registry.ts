// Registry of external (non-direct-scraper) sources.
// To add a new source: copy sources/exampleScraper.ts, implement it,
// then add it to REGISTERED_SCRAPERS below (order matters — first
// canHandle() match wins).

import type { SourceScraper } from './types';
import { novelPhoenixScraper } from './sources/novelphoenix';
// import { exampleScraper } from './sources/exampleScraper'; // <-- keep commented until it's a real source

const REGISTERED_SCRAPERS: SourceScraper[] = [
  novelPhoenixScraper,
];

/** Find the first registered external scraper that can handle this URL, or null */
export const findExternalScraper = (url: string): SourceScraper | null => {
  for (const scraper of REGISTERED_SCRAPERS) {
    try {
      if (scraper.canHandle(url)) return scraper;
    } catch {
      // A broken canHandle() shouldn't take down the whole registry lookup
      continue;
    }
  }
  return null;
};
