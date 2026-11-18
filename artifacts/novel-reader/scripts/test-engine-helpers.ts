/**
 * Unit tests for the pure helpers pulled out of the Add and Update download
 * engines (lib/addHelpers.ts, lib/updateHelpers.ts).
 *
 * Run with: pnpm exec tsx scripts/test-engine-helpers.ts
 *
 * No network, no React Native. Each check pins behaviour the screens depend
 * on, so a later refactor that changes it fails here instead of on a device.
 */

import {
  tryDirectSkip as addTryDirectSkip,
  extractChapterNumber as addExtractChapterNumber,
} from "../lib/addHelpers";
import {
  tryDirectSkip as updateTryDirectSkip,
  extractChapterNumber as updateExtractChapterNumber,
  getNextStartChapter,
  chapterExists,
  hostOf,
} from "../lib/updateHelpers";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const checks: { name: string; run: () => void }[] = [
  // ── Add: tryDirectSkip ──
  {
    name: "add tryDirectSkip: replaces chapter-N in a chapter-style URL",
    run: () =>
      assertEqual(
        addTryDirectSkip("https://example.com/novel/chapter-3.html", 4),
        "https://example.com/novel/chapter-4.html",
        "chapter-N",
      ),
  },
  {
    name: "add tryDirectSkip: replaces /N/ segment when no chapter keyword",
    run: () =>
      assertEqual(
        addTryDirectSkip("https://example.com/novel/123/", 9),
        "https://example.com/novel/9/",
        "slash",
      ),
  },
  {
    name: "add tryDirectSkip: returns null when URL has no number to swap",
    run: () =>
      assertEqual(
        addTryDirectSkip("https://example.com/novel/intro", 2),
        null,
        "no pattern",
      ),
  },

  // ── Add: extractChapterNumber ──
  {
    name: "add extractChapterNumber: reads 'Chapter 12: Title'",
    run: () =>
      assertEqual(
        addExtractChapterNumber("Chapter 12: The Gate"),
        12,
        "digits",
      ),
  },
  {
    name: "add extractChapterNumber: returns 0 for a title with no number",
    run: () => assertEqual(addExtractChapterNumber("Prologue"), 0, "no number"),
  },

  // ── Update: tryDirectSkip ──
  {
    name: "update tryDirectSkip: LightNovelWorld chapter path",
    run: () =>
      assertEqual(
        updateTryDirectSkip(
          "https://lightnovelworld.org/novel/x/chapter/10",
          11,
        ),
        "https://lightnovelworld.org/novel/x/chapter/11",
        "lnw",
      ),
  },
  {
    name: "update tryDirectSkip: generic chapter-N.html",
    run: () =>
      assertEqual(
        updateTryDirectSkip("https://site.com/novel/chapter-7.html", 8),
        "https://site.com/novel/chapter-8.html",
        "generic",
      ),
  },
  {
    name: "update tryDirectSkip: AsiaNovel always returns null (opaque IDs)",
    run: () =>
      assertEqual(
        updateTryDirectSkip(
          "https://www.asianovel.net/novel/x/chapter/chapter-773154/",
          2,
        ),
        null,
        "asianovel",
      ),
  },
  {
    name: "update tryDirectSkip: returns null for an unknown URL shape",
    run: () =>
      assertEqual(
        updateTryDirectSkip("https://site.com/novel/intro", 2),
        null,
        "unknown",
      ),
  },

  // ── Update: extractChapterNumber / getNextStartChapter ──
  {
    name: "update extractChapterNumber: reads 'Chapter 12: Title'",
    run: () =>
      assertEqual(
        updateExtractChapterNumber("Chapter 12: The Gate"),
        12,
        "digits",
      ),
  },
  {
    name: "update getNextStartChapter: empty novel starts at 1",
    run: () =>
      assertEqual(getNextStartChapter({ chapters: [] } as any), 1, "empty"),
  },
  {
    name: "update getNextStartChapter: continues after last numbered chapter",
    run: () =>
      assertEqual(
        getNextStartChapter({
          chapters: [{ title: "Chapter 39" }, { title: "Chapter 40" }],
        } as any),
        41,
        "numbered",
      ),
  },
  {
    name: "update getNextStartChapter: unnumbered titles fall back to count + 1",
    run: () =>
      assertEqual(
        getNextStartChapter({
          chapters: [
            { title: "Prologue" },
            { title: "Intro" },
            { title: "Side" },
          ],
        } as any),
        4,
        "unnumbered",
      ),
  },

  // ── Update: chapterExists / hostOf ──
  {
    name: "update chapterExists: matches by URL",
    run: () => {
      const chapters = [{ url: "https://a.com/1" }] as any;
      assertEqual(chapterExists("https://a.com/1", chapters), true, "hit");
      assertEqual(chapterExists("https://a.com/2", chapters), false, "miss");
    },
  },
  {
    name: "update hostOf: lowercases the hostname",
    run: () =>
      assertEqual(hostOf("https://Example.COM/novel/x"), "example.com", "host"),
  },
  {
    name: "update hostOf: returns empty string for a non-URL",
    run: () => assertEqual(hostOf("not a url"), "", "invalid"),
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
assert(checks.length > 0, "no checks registered");

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
