// Types for the external scraper registry layer.
// This is intentionally decoupled from useDirectScraper.ts — it only
// borrows the shape of NovelMeta / ChapterData so results are compatible
// with what useApi.ts (and the app screens) already expect.

import type { NovelMeta, ChapterData } from "../useDirectScraper";

export type { NovelMeta, ChapterData };

/**
 * Contract every "external" (non-direct-scraper) source must implement.
 *
 * canHandle(url) is checked in registry order — first match wins — so
 * more specific hostnames should be registered before broader ones.
 */
export interface SourceScraper {
  /** Unique id for logging/debugging, e.g. "example-source" */
  id: string;

  /** Human-readable name, e.g. "ExampleNovels.com" */
  name: string;

  /** Return true if this scraper should handle the given novel/chapter URL */
  canHandle: (url: string) => boolean;

  /** Fetch novel metadata (title, author, synopsis, cover, first chapter link) */
  fetchNovelMeta: (url: string) => Promise<NovelMeta>;

  /** Fetch a single chapter's content given the chapter URL */
  fetchChapter: (url: string, chapterNum: number) => Promise<ChapterData>;
}
