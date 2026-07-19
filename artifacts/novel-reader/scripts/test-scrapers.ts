/**
 * Scraper content-extraction regression tests.
 *
 * Run with: pnpm exec tsx scripts/test-scrapers.ts
 * (wired into CI via .github/workflows/Lint Test.yml — job "scraper-regression")
 *
 * Why this exists: novel-bin.ts and novelbincc.ts previously extracted
 * chapter content with a <p>-tag matcher (extractParagraphs), but the real
 * site markup wraps the chapter body in bare <br>-separated text inside
 * div#chr-content — not individual <p> tags. That mismatch silently saved
 * every chapter from those two sources as empty content. This test fixes a
 * known-good HTML fixture matching that real structure in place, so any
 * future edit that reintroduces a <p>-based extractor (or otherwise breaks
 * extraction) fails CI instead of shipping silently.
 *
 * No network calls — this only exercises the pure extraction functions
 * against fixture HTML, not fetchHtmlWithFallback.
 */

import { extractChapterBody as novelBinExtract } from '../hooks/scrapers/sources/novel-bin';
import { extractChapterBody as novelBinCcExtract } from '../hooks/scrapers/sources/novelbincc';

// Mirrors the real div#chr-content structure: a leading empty <p></p>, an
// <h4> repeating the chapter title, then the actual body as raw text nodes
// separated by bare <br> tags (NOT wrapped in <p> tags).
const FIXTURE_CHR_CONTENT = `
  <p></p>
  <h4>Chapter 12: The Water Mansion</h4>
  Chen Mobai stepped through the gate.<br>
  The air shimmered with spirit energy.<br><br>
  "Indeed," he murmured, "this place is different."<br>
  He walked on, unaware of what awaited him.
`;

type Check = { name: string; run: () => void };

const checks: Check[] = [
  {
    name: 'novel-bin.ts: extracts non-empty content from <br>-separated chr-content',
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(result.length > 0, `expected non-empty content, got: ${JSON.stringify(result)}`);
    },
  },
  {
    name: 'novel-bin.ts: strips the repeated <h4> chapter title from the body',
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(
        !result.includes('The Water Mansion'),
        `expected <h4> title to be stripped, but it leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: 'novel-bin.ts: preserves actual paragraph text',
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.includes('Chen Mobai stepped through the gate.'),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
      assert(
        result.includes('this place is different'),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: 'novelbincc.ts: extracts non-empty content from <br>-separated chr-content',
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(result.length > 0, `expected non-empty content, got: ${JSON.stringify(result)}`);
    },
  },
  {
    name: 'novelbincc.ts: strips the repeated <h4> chapter title from the body',
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(
        !result.includes('The Water Mansion'),
        `expected <h4> title to be stripped, but it leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: 'novelbincc.ts: preserves actual paragraph text',
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.includes('Chen Mobai stepped through the gate.'),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`  ok  ${check.name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${check.name}`);
    console.error(`      ${(err as Error).message}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) {
  process.exit(1);
}
