/**
 * Scraper content-extraction regression tests.
 *
 * Run with: pnpm exec tsx scripts/test-scrapers.ts
 * (wired into .github/workflows/ci-cd-pipeline.yml — job "scraper-regression")
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
import { extractNovGoContent as novgoExtract } from "../hooks/scrapers/sources/novgo";
import { extractNovelFullContent as readNovelFullExtract } from "../hooks/scrapers/sources/readnovelfull";
import { extractContentParagraphs as royalRoadExtract } from "../hooks/scrapers/sources/royalroad";
import { extractParagraphs as novelArrowExtract } from "../hooks/scrapers/sources/novelarrow";
import { extractParagraphs as novelPhoenixExtract } from "../hooks/scrapers/sources/novelphoenix";
import { extractFreeWebNovelContent as freeWebNovelExtract } from "../hooks/scrapers/sources/freewebnovel";
import { extractWuxiaworldContent as wuxiaworldExtract } from "../hooks/scrapers/sources/wuxiaworld";
import {
  parseLightNovelToMeta,
  parseLightNovelToChapter,
  lightNovelToScraper,
} from "../hooks/scrapers/sources/lightnovelto";
import { needsWebView } from "../hooks/scrapers/shared/webviewSites";
import {
  parseNovelBuddyMeta,
  parseNovelBuddyChapter,
  novelBuddyScraper,
} from "../hooks/scrapers/sources/novelbuddy";
import { findExternalScraper } from "../hooks/scrapers/registry";
import { looksLikeChallenge } from "../hooks/scrapers/shared/http";

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
const FIXTURE_NOVELBINCC_P_CONTENT = `<p>Chapter 12: The Water Mansion</p><p>Chen Mobai stepped through the gate.</p><p>The air shimmered with spirit energy.</p>`;

// NovGo scopes extraction to div#chapter-content; nav/tips live outside it.
const FIXTURE_NOVGO_PAGE = `
  <div class="tips"><p>Next Chapter</p></div>
  <div id="chapter-content">
    <p>Chen Mobai stepped through the gate.</p>
    <p>novgo.net</p>
    <p>The air shimmered with spirit energy.</p>
  </div>
`;

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
  {
    name: "novelbincc.ts: <p> markup drops the repeated chapter title paragraph",
    run: () => {
      const result = novelBinCcExtract(
        FIXTURE_NOVELBINCC_P_CONTENT,
        "Chapter 12: The Water Mansion",
      );
      assert(
        !result.includes("Water Mansion"),
        `expected repeated title <p> to be dropped, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novelbincc.ts: <p> markup preserves every body paragraph",
    run: () => {
      const result = novelBinCcExtract(
        FIXTURE_NOVELBINCC_P_CONTENT,
        "Chapter 12: The Water Mansion",
      );
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("The air shimmered with spirit energy."),
        `expected both paragraphs to survive, got: ${JSON.stringify(result)}`,
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

checks.push(
  {
    name: "novgo.ts: keeps only #chapter-content paragraphs",
    run: () => {
      const result = novgoExtract(FIXTURE_NOVGO_PAGE);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("The air shimmered with spirit energy.") &&
          !result.includes("Next Chapter"),
        `expected scoped body text, got: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "novgo.ts: filters out site-name notes without dropping sentences",
    run: () => {
      const result = novgoExtract(FIXTURE_NOVGO_PAGE);
      assert(
        !result.includes("novgo.net") && result.split("\n\n").length === 2,
        `expected only the 2 real paragraphs, got: ${JSON.stringify(result)}`,
      );
    },
  },
);

checks.push(
  {
    name: "shared/http.ts: detects Cloudflare challenge pages",
    run: () => {
      assert(
        looksLikeChallenge(
          "<html><title>Just a moment...</title><body>Checking your browser</body></html>",
        ),
        "expected a Cloudflare interstitial to be detected",
      );
    },
  },
  {
    name: "shared/http.ts: does not classify ordinary chapter HTML as a challenge",
    run: () => {
      assert(
        !looksLikeChallenge(
          "<html><title>Chapter 1</title><body><p>Story text.</p></body></html>",
        ),
        "ordinary chapter HTML must not be classified as a challenge",
      );
    },
  },
);

// Registry routing tests: verify each registered source resolves to its own
// scraper implementation. These are deterministic URL-routing checks; they
// do not make network requests or invoke fetchNovelMeta/fetchChapter.
const registryRoutes: Array<{ source: string; url: string }> = [
  {
    source: "novelphoenix",
    url: "https://novelphoenix.com/novel/we-agreed-on-experiencing-life-so-why-did-you-immortals-become-real/chapter-1",
  },
  {
    source: "novelbin",
    url: "https://novel-bin.com/b/reborn-as-an-ancient-tree/chapter-1",
  },
  {
    source: "novelbincc",
    url: "https://novelbin.cc/book/unprecedented-pill-refiner-entitled-ninth-young-lady-novel/chapter-1",
  },
  {
    source: "novelping",
    url: "https://novelping.com/book/shadow-slave/chapter-1-nightmare-begins",
  },
  {
    source: "royalroad",
    url: "https://www.royalroad.com/fiction/202598/my-client-is-the-most-dangerous-woman-in-every/chapter/4292319/chapter-1-applications-61-offers-0",
  },
  {
    source: "readnovelfull",
    url: "https://readnovelfull.com/my-sect-is-down-to-seven-people/chapter-1-a-bronze-token.html",
  },
  {
    source: "novelfullcom",
    url: "https://novelfull.com/system-build-my-own-territory/chapter-1-heavenly-artifacts.html",
  },
  {
    source: "novelfullnet",
    url: "https://novelfull.net/i-materialized-the-cultivation-game/chapter-1-loading-into-the-game-world.html",
  },
  {
    source: "novgo",
    url: "https://novgo.net/divine-level-base/chapter-1-void-demon.html",
  },
  {
    source: "freewebnovel",
    url: "https://freewebnovel.com/novel/i-turn-my-masters-fake-techniques-into-reality/chapter-1",
  },
  {
    source: "wuxiaworld",
    url: "https://wuxiaworld.site/novel/a-blessed-wife-at-home/chapter-1/",
  },
  {
    source: "novelarchivecc",
    url: "https://novelarchive.st/reader?novel=6a7260f01e3db0813cc1a103&chapter=1",
  },
  {
    source: "fanmtl",
    url: "https://www.fanmtl.com/novel/lord-more-children-more-blessings-build-a-family-of-gods_1.html",
  },
  { source: "wuxiabox", url: "https://www.wuxiabox.com/novel/kks45080_1.html" },
  {
    source: "wuxiaclick",
    url: "https://wuxia.click/chapter/stop-friendly-fire-1",
  },
  {
    source: "mtlnovel-me",
    url: "https://mtlnovel.me/read/i-have-a-time-and-space-garden/chapter-1-opening-1-time-and-space-garden/",
  },
];

for (const route of registryRoutes) {
  checks.push({
    name: `registry: routes ${route.url} to ${route.source}`,
    run: () => {
      const scraper = findExternalScraper(route.url);
      assert(
        scraper?.id === route.source,
        `expected ${route.source}, received ${scraper?.id ?? "no matching scraper"} for ${route.url}`,
      );
    },
  });
}

checks.push(
  {
    name: "registry: returns null for unsupported hosts",
    run: () => {
      assert(
        findExternalScraper("https://unsupported.example/chapter-1") === null,
        "expected unsupported host to have no external scraper",
      );
    },
  },
  {
    name: "registry: returns null for malformed URLs",
    run: () => {
      assert(
        findExternalScraper("not-a-valid-url") === null,
        "expected malformed URL to have no external scraper",
      );
    },
  },
);

// ── LightNovelTo (lightnovel.to) ─────────────────────────────────────────
// Fixtures below are hand-written placeholders that copy only the page
// structure (class names and tags), not any real novel text.
const LNT_NOVEL_PAGE = `
  <html><body>
    <h1 class="ln-dtitle text-balance">Sample Novel Title</h1>
    <a class="ln-v" href="/author/sample-author">Sample Author</a>
    <div class="ln-dcv"><img src="https://lightnovel.to/uploads/cover.webp" alt=""></div>
    <div class="ln-syn"><p>First placeholder synopsis line.</p><p>Second placeholder line.</p></div>
    <a class="ln-sb ln-pri" href="/novel/sample-novel/chapter-1">Start Chapter 1</a>
  </body></html>
`;

const LNT_CHAPTER_PAGE = `
  <html><body>
    <h1 class="text-balance text-2xl font-semibold">Chapter 1 - Sample Opening</h1>
    <div class="ln-prose" style="font-size: 19px;">
      <p>Placeholder paragraph one.</p>
      <div class="advertisment"><script src="https://ads.example/x.js"></script></div>
      <p>Placeholder paragraph two.</p>
    </div>
    <a class="ln-chapnav-side ln-chapnav-next" href="/novel/sample-novel/chapter-2"><span>Next</span></a>
  </body></html>
`;

const LNT_LAST_CHAPTER_PAGE = LNT_CHAPTER_PAGE.replace(
  '<a class="ln-chapnav-side ln-chapnav-next" href="/novel/sample-novel/chapter-2">',
  '<a class="ln-chapnav-side ln-chapnav-next" aria-disabled="true" href="#">',
);

checks.push(
  {
    name: "lightnovelto: novel page yields title, author, cover, synopsis",
    run: () => {
      const meta = parseLightNovelToMeta(
        LNT_NOVEL_PAGE,
        "https://lightnovel.to/novel/sample-novel",
      );
      assert(meta.title === "Sample Novel Title", `title: ${meta.title}`);
      assert(meta.author === "Sample Author", `author: ${meta.author}`);
      assert(
        meta.coverUrl === "https://lightnovel.to/uploads/cover.webp",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis.includes("First placeholder synopsis line.") &&
          meta.synopsis.includes("Second placeholder line."),
        `synopsis: ${JSON.stringify(meta.synopsis)}`,
      );
    },
  },
  {
    name: "lightnovelto: novel page resolves the first chapter URL",
    run: () => {
      const meta = parseLightNovelToMeta(
        LNT_NOVEL_PAGE,
        "https://lightnovel.to/novel/sample-novel",
      );
      assert(
        meta.firstChapterUrl ===
          "https://lightnovel.to/novel/sample-novel/chapter-1",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "lightnovelto: chapter page yields title and paragraph text",
    run: () => {
      const ch = parseLightNovelToChapter(
        LNT_CHAPTER_PAGE,
        "https://lightnovel.to/novel/sample-novel/chapter-1",
      );
      assert(ch.title === "Chapter 1 - Sample Opening", `title: ${ch.title}`);
      assert(
        ch.content.includes("Placeholder paragraph one.") &&
          ch.content.includes("Placeholder paragraph two."),
        `content: ${JSON.stringify(ch.content)}`,
      );
    },
  },
  {
    name: "lightnovelto: chapter content skips ad blocks",
    run: () => {
      const ch = parseLightNovelToChapter(
        LNT_CHAPTER_PAGE,
        "https://lightnovel.to/novel/sample-novel/chapter-1",
      );
      assert(
        !ch.content.includes("ads.example") && !ch.content.includes("<script"),
        `ad markup leaked into content: ${JSON.stringify(ch.content)}`,
      );
    },
  },
  {
    name: "lightnovelto: next link resolves to an absolute URL",
    run: () => {
      const ch = parseLightNovelToChapter(
        LNT_CHAPTER_PAGE,
        "https://lightnovel.to/novel/sample-novel/chapter-1",
      );
      assert(
        ch.nextUrl === "https://lightnovel.to/novel/sample-novel/chapter-2",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "lightnovelto: last chapter (aria-disabled next) has no next URL",
    run: () => {
      const ch = parseLightNovelToChapter(
        LNT_LAST_CHAPTER_PAGE,
        "https://lightnovel.to/novel/sample-novel/chapter-9",
      );
      assert(
        ch.nextUrl === null,
        `expected null nextUrl on last chapter, got: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "lightnovelto: canHandle accepts lightnovel.to and subdomains only",
    run: () => {
      assert(
        lightNovelToScraper.canHandle("https://lightnovel.to/novel/x"),
        "lightnovel.to should match",
      );
      assert(
        lightNovelToScraper.canHandle("https://www.lightnovel.to/novel/x"),
        "www subdomain should match",
      );
      assert(
        !lightNovelToScraper.canHandle("https://lightnovel.to.evil.example/x"),
        "lookalike host must not match",
      );
      assert(
        !lightNovelToScraper.canHandle("https://evil.example/lightnovel.to"),
        "host in path must not match",
      );
    },
  },
  {
    name: "lightnovelto: registry finds the scraper for lightnovel.to",
    run: () => {
      const found = findExternalScraper(
        "https://lightnovel.to/novel/sample-novel",
      );
      assert(
        found?.id === "lightnovelto",
        `registry returned: ${found?.id ?? "null"}`,
      );
    },
  },
  {
    name: "lightnovelto: WebView tier is enabled for lightnovel.to",
    run: () => {
      assert(
        needsWebView("https://lightnovel.to/novel/sample-novel"),
        "lightnovel.to should use the WebView tier",
      );
      assert(
        !needsWebView("https://example.com/novel"),
        "unrelated host should not use the WebView tier",
      );
    },
  },
);

// ── NovelBuddy (novelbuddy.me) ───────────────────────────────────────────
// Hand-written placeholder fixtures that copy only the page structure.
const NB_NOVEL_PAGE = `
  <html><body>
    <img src="https://rs.novelbuddy.me/covers/sample-novel.png" alt="Sample Novel">
    <h1 class="font-display text-[30px] font-bold">Sample Novel</h1>
    <div class="flex flex-wrap gap-x-2"><a href="/authors/sample-author">Sample Author</a></div>
    <p class="text-[14px] leading-relaxed text-fg-muted">A placeholder synopsis line.</p>
    <a href="/sample-novel/chapter-1-opening"><button type="button" class="btn">
      <svg></svg> Start Reading</button></a>
  </body></html>
`;

const NB_CHAPTER_PAGE = `
  <html><body>
    <p class="mt-1.5 text-[14px]">Chapter 1: Sample Opening</p>
    <div class="novel-tts-content px-7">
      <p>Placeholder paragraph one.</p>
      <div style="margin-top:0px"><div></div></div>
      <p>Placeholder paragraph two.</p>
    </div>
    <a class="reader-btn reader-step" aria-label="Next chapter" href="/sample-novel/chapter-2-next">next</a>
  </body></html>
`;

const NB_LAST_CHAPTER_PAGE = NB_CHAPTER_PAGE.replace(
  /<a class="reader-btn reader-step" aria-label="Next chapter"[^>]*>next<\/a>/,
  "",
);

checks.push(
  {
    name: "novelbuddy: novel page yields title, author, cover, synopsis",
    run: () => {
      const meta = parseNovelBuddyMeta(
        NB_NOVEL_PAGE,
        "https://novelbuddy.me/sample-novel",
      );
      assert(meta.title === "Sample Novel", `title: ${meta.title}`);
      assert(meta.author === "Sample Author", `author: ${meta.author}`);
      assert(
        meta.coverUrl === "https://rs.novelbuddy.me/covers/sample-novel.png",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis.includes("placeholder synopsis"),
        `synopsis: ${meta.synopsis}`,
      );
    },
  },
  {
    name: "novelbuddy: novel page resolves the Start Reading link",
    run: () => {
      const meta = parseNovelBuddyMeta(
        NB_NOVEL_PAGE,
        "https://novelbuddy.me/sample-novel",
      );
      assert(
        meta.firstChapterUrl ===
          "https://novelbuddy.me/sample-novel/chapter-1-opening",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "novelbuddy: chapter page yields title and paragraphs",
    run: () => {
      const ch = parseNovelBuddyChapter(
        NB_CHAPTER_PAGE,
        "https://novelbuddy.me/sample-novel/chapter-1-opening",
      );
      assert(ch.title === "Chapter 1: Sample Opening", `title: ${ch.title}`);
      assert(
        ch.content.includes("Placeholder paragraph one.") &&
          ch.content.includes("Placeholder paragraph two."),
        `content: ${JSON.stringify(ch.content)}`,
      );
    },
  },
  {
    name: "novelbuddy: chapter page resolves the next chapter",
    run: () => {
      const ch = parseNovelBuddyChapter(
        NB_CHAPTER_PAGE,
        "https://novelbuddy.me/sample-novel/chapter-1-opening",
      );
      assert(
        ch.nextUrl === "https://novelbuddy.me/sample-novel/chapter-2-next",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "novelbuddy: last chapter (no next link) has no next URL",
    run: () => {
      const ch = parseNovelBuddyChapter(
        NB_LAST_CHAPTER_PAGE,
        "https://novelbuddy.me/sample-novel/chapter-9",
      );
      assert(ch.nextUrl === null, `expected null nextUrl, got: ${ch.nextUrl}`);
    },
  },
  {
    name: "novelbuddy: canHandle accepts novelbuddy.me and subdomains only",
    run: () => {
      assert(
        novelBuddyScraper.canHandle("https://novelbuddy.me/sample-novel"),
        "novelbuddy.me should match",
      );
      assert(
        novelBuddyScraper.canHandle("https://www.novelbuddy.me/sample-novel"),
        "www subdomain should match",
      );
      assert(
        !novelBuddyScraper.canHandle("https://novelbuddy.me.evil.example/x"),
        "lookalike host must not match",
      );
    },
  },
  {
    name: "novelbuddy: registry finds the scraper and WebView tier is enabled",
    run: () => {
      const found = findExternalScraper("https://novelbuddy.me/sample-novel");
      assert(
        found?.id === "novelbuddy",
        `registry returned: ${found?.id ?? "null"}`,
      );
      assert(
        needsWebView("https://novelbuddy.me/sample-novel"),
        "novelbuddy.me should use the WebView tier",
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
