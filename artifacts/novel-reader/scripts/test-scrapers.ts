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
 * every chapter from those two sources as empty content. This test fixed a
 * known-good HTML fixture matching that real structure in place, so any
 * future edit that reintroduces a <p>-based extractor (or otherwise breaks
 * extraction) fails CI instead of shipping silently.
 *
 * Coverage was originally limited to novel-bin/novelbincc. It has since
 * been expanded to cover every real scraper source: allnovel, freewebnovel,
 * novelarrow, novelfullcom, novelfullnet, novelphoenix, novgo,
 * readnovelfull, royalroad, and wuxiaworld. Each source's inline content
 * extraction logic was pulled out into a named, exported pure function
 * (e.g. extractNovelFullContent, extractFreeWebNovelContent,
 * extractWuxiaworldContent) specifically so it could be exercised here
 * without a network call. exampleScraper.ts is a template, not a real
 * source, and is intentionally excluded.
 *
 * No network calls — this only exercises the pure extraction functions
 * against fixture HTML, not fetchHtmlWithFallback.
 */

import { extractChapterBody as novelBinExtract } from "../hooks/scrapers/sources/novel-bin";
import { extractChapterBody as novelBinCcExtract } from "../hooks/scrapers/sources/novelbincc";
import { extractNovelFullContent as allNovelExtract } from "../hooks/scrapers/sources/allnovel";
import { extractNovelFullContent as novelFullComExtract } from "../hooks/scrapers/sources/novelfullcom";
import { extractNovelFullContent as novelFullNetExtract } from "../hooks/scrapers/sources/novelfullnet";
import { extractNovelFullContent as novgoExtract } from "../hooks/scrapers/sources/novgo";
import { extractNovelFullContent as readNovelFullExtract } from "../hooks/scrapers/sources/readnovelfull";
import { extractContentParagraphs as royalRoadExtract } from "../hooks/scrapers/sources/royalroad";
import { extractParagraphs as novelArrowExtract } from "../hooks/scrapers/sources/novelarrow";
import { extractParagraphs as novelPhoenixExtract } from "../hooks/scrapers/sources/novelphoenix";
import { extractFreeWebNovelContent as freeWebNovelExtract } from "../hooks/scrapers/sources/freewebnovel";
import { extractWuxiaworldContent as wuxiaworldExtract } from "../hooks/scrapers/sources/wuxiaworld";

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

// Standard <p>-tag-based chapter body, used by the "NovelFull family"
// (allnovel, novelfullcom, novelfullnet, novgo, readnovelfull) plus
// royalroad/novelarrow/novelphoenix, all of which extract via <p> tags
// rather than novel-bin's <br>-separated markup.
const FIXTURE_P_TAG_CONTENT = `
  <p>Chen Mobai stepped through the gate.</p>
  <p>The air shimmered with spirit energy.</p>
  <p>"Indeed," he murmured, "this place is different."</p>
  <p>Next Chapter</p>
  <p>novelfull.com</p>
`;

// Same <p>-tag body but wrapped as freewebnovel would present it, including
// a junk/ad paragraph that should be filtered out.
const FIXTURE_FREEWEBNOVEL_CONTENT = `
  <p>Chen Mobai stepped through the gate.</p>
  <p>The air shimmered with spirit energy.</p>
  <p>Please visit freewebnovel.com for more chapters.</p>
  <p>Support the author on patreon.</p>
`;

// wuxiaworld's extractor takes the already-isolated content block, not raw
// page HTML, and handles both <p>-wrapped and <br>-separated bodies.
const FIXTURE_WUXIAWORLD_P_CONTENT = `
  <p>Chen Mobai stepped through the gate.</p>
  <p>The air shimmered with spirit energy.<br>He walked on.</p>
`;
const FIXTURE_WUXIAWORLD_BR_ONLY_CONTENT = `Chen Mobai stepped through the gate.<br>The air shimmered with spirit energy.`;

type Check = { name: string; run: () => void };

const checks: Check[] = [
  {
    name: "novel-bin.ts: extracts non-empty content from <br>-separated chr-content",
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.length > 0,
        `expected non-empty content, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novel-bin.ts: strips the repeated <h4> chapter title from the body",
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(
        !result.includes("The Water Mansion"),
        `expected <h4> title to be stripped, but it leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novel-bin.ts: preserves actual paragraph text",
    run: () => {
      const result = novelBinExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate."),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
      assert(
        result.includes("this place is different"),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelbincc.ts: extracts non-empty content from <br>-separated chr-content",
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.length > 0,
        `expected non-empty content, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelbincc.ts: strips the repeated <h4> chapter title from the body",
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(
        !result.includes("The Water Mansion"),
        `expected <h4> title to be stripped, but it leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelbincc.ts: preserves actual paragraph text",
    run: () => {
      const result = novelBinCcExtract(FIXTURE_CHR_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate."),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
];

// "NovelFull family" — identical extraction logic shared by these 5 sources.
const novelFullFamily: Array<{
  name: string;
  extract: (html: string) => string;
}> = [
  { name: "allnovel.ts", extract: allNovelExtract },
  { name: "novelfullcom.ts", extract: novelFullComExtract },
  { name: "novelfullnet.ts", extract: novelFullNetExtract },
  { name: "novgo.ts", extract: novgoExtract },
  { name: "readnovelfull.ts", extract: readNovelFullExtract },
];

for (const { name, extract } of novelFullFamily) {
  checks.push(
    {
      name: `${name}: extracts non-empty content from <p>-tag body`,
      run: () => {
        const result = extract(FIXTURE_P_TAG_CONTENT);
        assert(
          result.length > 0,
          `expected non-empty content, got: ${JSON.stringify(result)}`,
        );
      },
    },
    {
      name: `${name}: preserves actual paragraph text`,
      run: () => {
        const result = extract(FIXTURE_P_TAG_CONTENT);
        assert(
          result.includes("Chen Mobai stepped through the gate."),
          `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
        );
      },
    },
    {
      name: `${name}: filters out "Next Chapter" nav text`,
      run: () => {
        const result = extract(FIXTURE_P_TAG_CONTENT);
        assert(
          !result.includes("Next Chapter"),
          `expected nav text to be filtered, but it leaked into content: ${JSON.stringify(result)}`,
        );
      },
    },
    {
      name: `${name}: filters out site-name junk paragraph`,
      run: () => {
        const result = extract(FIXTURE_P_TAG_CONTENT);
        // Note: this checks that a known junk phrase was stripped from
        // extracted article text, not a URL/host — not a security check.
        // codeql[js/incomplete-url-substring-sanitization]
        assert(
          !result.includes("novelfull.com"),
          `expected junk paragraph to be filtered, but it leaked into content: ${JSON.stringify(result)}`,
        );
      },
    },
  );
}

// royalroad.ts and novelarrow.ts / novelphoenix.ts checks
checks.push(
  {
    name: "royalroad.ts: extracts non-empty content from <p>-tag body",
    run: () => {
      const result = royalRoadExtract(FIXTURE_P_TAG_CONTENT);
      assert(
        result.length > 0,
        `expected non-empty content, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "royalroad.ts: preserves actual paragraph text and filters nav text",
    run: () => {
      const result = royalRoadExtract(FIXTURE_P_TAG_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate."),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
      assert(
        !result.includes("Next Chapter"),
        `expected nav text to be filtered, but it leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelarrow.ts: extracts and joins <p>-tag paragraphs",
    run: () => {
      const result = novelArrowExtract(FIXTURE_P_TAG_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("this place is different"),
        `expected all paragraph text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelphoenix.ts: extracts and joins <p>-tag paragraphs",
    run: () => {
      const result = novelPhoenixExtract(FIXTURE_P_TAG_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("this place is different"),
        `expected all paragraph text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "freewebnovel.ts: extracts non-empty content and preserves body text",
    run: () => {
      const result = freeWebNovelExtract(FIXTURE_FREEWEBNOVEL_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate."),
        `expected body text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "freewebnovel.ts: filters out ad/junk paragraphs",
    run: () => {
      const result = freeWebNovelExtract(FIXTURE_FREEWEBNOVEL_CONTENT);
      assert(
        !result.toLowerCase().includes("patreon") &&
          !result.toLowerCase().includes("please visit"),
        `expected junk paragraphs to be filtered, but leaked into content: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "wuxiaworld.ts: extracts <p>-wrapped content, converting inner <br> to breaks",
    run: () => {
      const result = wuxiaworldExtract(FIXTURE_WUXIAWORLD_P_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("He walked on."),
        `expected all paragraph text to survive extraction, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "wuxiaworld.ts: falls back to raw <br>-separated text when no <p> tags present",
    run: () => {
      const result = wuxiaworldExtract(FIXTURE_WUXIAWORLD_BR_ONLY_CONTENT);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("The air shimmered with spirit energy."),
        `expected fallback extraction to preserve body text, got: ${JSON.stringify(result)}`,
      );
    },
  },
);

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
