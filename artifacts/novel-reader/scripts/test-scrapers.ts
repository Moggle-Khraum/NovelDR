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
import {
  needsWebView,
  needsUserChallenge,
} from "../hooks/scrapers/shared/webviewSites";
import {
  parseNovelBuddyMeta,
  parseNovelBuddyChapter,
  novelBuddyScraper,
} from "../hooks/scrapers/sources/novelbuddy";
import {
  parseCentralNovelMeta,
  parseCentralNovelChapter,
  centralNovelScraper,
} from "../hooks/scrapers/sources/centralnovel";
import {
  parseMeioNovelsMeta,
  parseMeioNovelsChapter,
  meioNovelsScraper,
} from "../hooks/scrapers/sources/meionovels";
import {
  parseMtlNovelMeta,
  parseMtlNovelChapter,
  mtlNovelScraper,
} from "../hooks/scrapers/sources/mtlnovel";
import {
  parseRaNovelMeta,
  parseRaNovelChapter,
  raNovelScraper,
} from "../hooks/scrapers/sources/ranovel";
import {
  parseJaomixMeta,
  parseJaomixChapter,
  parseJaomixFirstChapter,
  jaomixScraper,
} from "../hooks/scrapers/sources/jaomix";
import {
  parseLightNovelWorldNetMeta,
  parseLightNovelWorldNetChapter,
  lightNovelWorldNetScraper,
} from "../hooks/scrapers/sources/lightnovelworldnet";
import {
  parseNovelasLigeraMeta,
  parseNovelasLigeraChapter,
  novelasLigeraScraper,
} from "../hooks/scrapers/sources/novelasligera";
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
    <div class="ln-synwrap"><div class="ln-syn"><p>First placeholder synopsis line.</p><p>Second placeholder line.</p></div></div>
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

// ── CentralNovel (centralnovel.com) ──────────────────────────────────────
// Hand-written placeholder fixtures that copy only the page structure.
const CN_SERIES_PAGE = `
  <html><body>
    <img src="https://i3.wp.com/centralnovel.com/wp-content/uploads/sample.png?resize=370,500" class="ts-post-image" itemprop="image">
    <h1 class="entry-title" itemprop="name"><font>Sample Novel</font></h1>
    <span><b>Autor:</b> <a href="https://centralnovel.com/writer/sample-author/" rel="tag">Sample Author</a></span>
    <div class="bixbox synp">
      <div class="entry-content" itemprop="description">
        <p>A placeholder synopsis line.</p>
      </div>
    </div>
    <div class="lastend"><div class="inepcx">
      <a href="https://centralnovel.com/sample-novel-capitulo-1/">
        <span>First Chapter</span>
      </a>
    </div></div>
  </body></html>
`;

const CN_CHAPTER_PAGE = `
  <html><body>
    <h1 class="entry-title" itemprop="headline">Sample
Novel – Capítulo 1</h1>
    <div class="epcontent entry-content" itemprop="text">
      <div id="leitor-serie-body"><p>Placeholder paragraph one.</p><p>Placeholder paragraph two.</p></div>
    </div>
    <div class="announ"><a href="https://centralnovel.com/doacao/">donate</a></div>
    <a aria-label="next" href="https://centralnovel.com/sample-novel-capitulo-2/" rel="next">Próximo</a>
  </body></html>
`;

checks.push(
  {
    name: "centralnovel: series page yields title, author, cover, synopsis, first chapter",
    run: () => {
      const meta = parseCentralNovelMeta(
        CN_SERIES_PAGE,
        "https://centralnovel.com/series/sample-novel/",
      );
      assert(meta.title === "Sample Novel", `title: ${meta.title}`);
      assert(meta.author === "Sample Author", `author: ${meta.author}`);
      assert(
        meta.coverUrl ===
          "https://i3.wp.com/centralnovel.com/wp-content/uploads/sample.png?resize=370,500",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis === "A placeholder synopsis line.",
        `synopsis: ${meta.synopsis}`,
      );
      assert(
        meta.firstChapterUrl ===
          "https://centralnovel.com/sample-novel-capitulo-1/",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "centralnovel: first chapter found with Portuguese label",
    run: () => {
      const meta = parseCentralNovelMeta(
        CN_SERIES_PAGE.replace("First Chapter", "Primeiro Capítulo"),
        "https://centralnovel.com/series/sample-novel/",
      );
      assert(
        meta.firstChapterUrl ===
          "https://centralnovel.com/sample-novel-capitulo-1/",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "centralnovel: chapter page yields title, paragraphs and next chapter",
    run: () => {
      const ch = parseCentralNovelChapter(
        CN_CHAPTER_PAGE,
        "https://centralnovel.com/sample-novel-capitulo-1/",
      );
      assert(ch.title === "Sample Novel – Capítulo 1", `title: ${ch.title}`);
      assert(
        ch.content ===
          "Placeholder paragraph one.\n\nPlaceholder paragraph two.",
        `content: ${JSON.stringify(ch.content)}`,
      );
      assert(
        ch.nextUrl === "https://centralnovel.com/sample-novel-capitulo-2/",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "centralnovel: canHandle accepts centralnovel.com and subdomains only",
    run: () => {
      assert(
        centralNovelScraper.canHandle("https://centralnovel.com/series/x/"),
        "centralnovel.com should match",
      );
      assert(
        centralNovelScraper.canHandle("https://www.centralnovel.com/x/"),
        "www.centralnovel.com should match",
      );
      assert(
        !centralNovelScraper.canHandle(
          "https://centralnovel.com.evil.example/x",
        ),
        "lookalike host should not match",
      );
    },
  },
  {
    name: "centralnovel: registry finds the scraper and WebView tier is enabled",
    run: () => {
      const found = findExternalScraper("https://centralnovel.com/series/x/");
      assert(
        found?.id === "centralnovel",
        `registry returned: ${found?.id ?? "null"}`,
      );
      assert(
        needsWebView("https://centralnovel.com/series/x/"),
        "centralnovel.com should use the WebView tier",
      );
    },
  },
);

// ── NovelasLigera (novelasligeras.net) ───────────────────────────────────
// Hand-written placeholder fixtures that copy only the page structure of a
// real novel page and chapter page (WooCommerce product + WPBakery tabs), not
// any real novel text.
const NL_NOVEL_PAGE = `
  <html><head>
    <meta property="og:image" content="https://novelasligeras.net/wp-content/uploads/2023/11/Sample-Novel.jpg">
  </head><body>
    <div class="summary entry-summary" style="height: auto !important;">
      <h1 class="product_title entry-title">Sample Novel (NW)</h1>
      <div class="woocommerce-product-details__short-description" style="height: auto !important;">
        <p>Placeholder synopsis line one.</p>
        <p><strong>[Placeholder bold line]</strong></p>
        <div class="google-auto-placed"><ins class="adsbygoogle"><div id="ad"><iframe src="https://ads.example/x"></iframe></div></ins></div>
        <p>Placeholder synopsis line two.</p>
        <p style="text-align: right;"><em><strong>Sinopsis por NOVA</strong></em></p>
      </div>
    </div>
    <table class="woocommerce-product-attributes shop_attributes"><tbody>
      <tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--attribute_pa_nombres-alternativos"><th class="woocommerce-product-attributes-item__label" scope="row">Nombre(s) Alternativo(s)</th><td class="woocommerce-product-attributes-item__value"><p>Alt Name</p></td></tr>
      <tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--attribute_pa_escritor"><th class="woocommerce-product-attributes-item__label" scope="row">Escritor</th><td class="woocommerce-product-attributes-item__value"><p><a href="https://novelasligeras.net/index.php/filtro/escritor/sample-author/" rel="tag">Sample Author</a></p></td></tr>
    </tbody></table>
    <div class="wpb_tour wpb_content_element tab-style-one"><div class="wpb_wrapper wpb_tour_tabs_wrapper">
      <ul class="wpb_tabs_nav"><li><a href="#tab-1">Capitulos del 01 al 10</a></li><li><a href="#tab-2">Capitulos del 11 al 20</a></li></ul>
      <div id="tab-2" class="wpb_tab"><div class="wpb_text_column"><div class="wpb_wrapper">
        <p><a href="https://novelasligeras.net/index.php/2023/12/01/sample-novel-capitulo-11-novela-ligera/">Capítulo 11: Sample</a></p><p>&nbsp;</p>
      </div></div></div>
      <div id="tab-1" class="wpb_tab"><div class="wpb_text_column"><div class="wpb_wrapper"><div class="wf-cell wf-1"><article><div class="post-content">
        <p><a href="https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-2-novela-ligera/">Capitulo 2: Sample (Parte 2).</a></p><p>&nbsp;</p>
      </div></article></div><div class="wf-cell wf-1"><article><div class="post-content">
        <p><a href="https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-1-novela-ligera/">Capítulo 1: Sample (Parte 1)</a></p><p>&nbsp;</p>
      </div></article></div></div></div></div>
    </div></div>
    <div class="latest"><a href="https://novelasligeras.net/index.php/2023/11/12/other-novel-capitulo-0-novela-ligera/">Capítulo 0: Other novel</a></div>
  </body></html>
`;

const NL_CHAPTER_PAGE = `
  <html><head><title>Sample Novel Capítulo 1 Novela Ligera - NOVA</title></head><body>
    <article class="single-postlike"><div class="entry-content" style="height: auto !important;"><div class="wpb-content-wrapper">
      <div class="vc_row"><div class="vc_col-sm-4"><div class="wpb_wrapper"></div></div>
        <div class="vc_col-sm-4"><div class="wpb_wrapper"><div class="btn-align-center"><a href="https://novelasligeras.net/index.php/producto/sample-novel-novela-web/" class="dt-btn" title="Sample Novel (NW)"><i class="fa fa-book"></i><span>Indice</span></a></div></div></div>
        <div class="vc_col-sm-4"><div class="wpb_wrapper"><div class="btn-align-right"><a href="https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-2-novela-ligera/" class="dt-btn ico-right-side" title="Capítulo 2: Sample"><span>Siguiente</span><i class="fa fa-arrow-right"></i></a></div></div></div></div>
      <div class="vc_row"><div class="wpb_text_column"><div class="wpb_wrapper">
        <h1>Sample Novel</h1><h2>Volumen 1</h2><h2>Capítulo 1: Sample (Parte 1)</h2>
        <p>&nbsp;</p>
        <p>Placeholder paragraph one.</p>
        <div class="google-auto-placed"><ins class="adsbygoogle"><div id="ad"><iframe src="https://ads.example/x"></iframe></div></ins></div>
        <p>Placeholder text.<div class="google-anno-skip google-anno-sc" role="link" aria-label="Explorar mitos"><span>Explorar mitos</span></div></p>
        <script>var x = 1;</script>
        <p>Placeholder paragraph two.</p>
      </div></div></div>
    </div></div></article>
    <div class="author-info entry-author"><p>About the site author</p></div>
  </body></html>
`;

checks.push(
  {
    name: "novelasligera: novel page yields title, author, cover, synopsis, lowest chapter as first",
    run: () => {
      const meta = parseNovelasLigeraMeta(
        NL_NOVEL_PAGE,
        "https://novelasligeras.net/index.php/producto/sample-novel-novela-web/",
      );
      assert(meta.title === "Sample Novel (NW)", `title: ${meta.title}`);
      assert(meta.author === "Sample Author", `author: ${meta.author}`);
      assert(
        meta.coverUrl ===
          "https://novelasligeras.net/wp-content/uploads/2023/11/Sample-Novel.jpg",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis ===
          "Placeholder synopsis line one.\n\n[Placeholder bold line]\n\nPlaceholder synopsis line two.",
        `synopsis: ${JSON.stringify(meta.synopsis)}`,
      );
      assert(
        meta.firstChapterUrl ===
          "https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-1-novela-ligera/",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "novelasligera: chapter page gives heading, clean paragraphs and next chapter",
    run: () => {
      const ch = parseNovelasLigeraChapter(
        NL_CHAPTER_PAGE,
        "https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-1-novela-ligera/",
      );
      assert(ch.title === "Capítulo 1: Sample (Parte 1)", `title: ${ch.title}`);
      assert(
        ch.content ===
          "Placeholder paragraph one.\n\nPlaceholder text.\n\nPlaceholder paragraph two.",
        `content: ${JSON.stringify(ch.content)}`,
      );
      assert(
        ch.nextUrl ===
          "https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-2-novela-ligera/",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "novelasligera: no Siguiente button, or one pointing at the novel page, gives nextUrl null",
    run: () => {
      const noNext = NL_CHAPTER_PAGE.replace(
        "<span>Siguiente</span>",
        "<span>Indice</span>",
      );
      assert(
        parseNovelasLigeraChapter(noNext, "https://novelasligeras.net/x/")
          .nextUrl === null,
        "missing Siguiente should give null",
      );
      const toIndex = NL_CHAPTER_PAGE.replace(
        "https://novelasligeras.net/index.php/2023/11/12/sample-novel-capitulo-2-novela-ligera/",
        "https://novelasligeras.net/index.php/producto/sample-novel-novela-web/",
      );
      assert(
        parseNovelasLigeraChapter(toIndex, "https://novelasligeras.net/x/")
          .nextUrl === null,
        "Siguiente pointing at the novel page should give null",
      );
    },
  },
  {
    name: "novelasligera: canHandle accepts novelasligeras.net, the old .com, and subdomains only",
    run: () => {
      for (const ok of [
        "https://novelasligeras.net/index.php/producto/x/",
        "https://www.novelasligeras.net/x/",
        "https://novelasligera.com/x/",
      ]) {
        assert(novelasLigeraScraper.canHandle(ok), `${ok} should match`);
      }
      assert(
        !novelasLigeraScraper.canHandle(
          "https://novelasligeras.net.evil.example/x",
        ),
        "lookalike host should not match",
      );
    },
  },
  {
    name: "novelasligera: registry finds the scraper; WebView tier on and checkbox prompt allowed",
    run: () => {
      const url = "https://novelasligeras.net/index.php/producto/x/";
      const found = findExternalScraper(url);
      assert(
        found?.id === "novelasligera",
        `registry returned: ${found?.id ?? "null"}`,
      );
      assert(needsWebView(url), "should use the WebView tier");
      assert(needsUserChallenge(url), "should allow the checkbox prompt");
      assert(
        !needsUserChallenge("https://royalroad.com/fiction/1/x"),
        "sites without a checkbox should stay hidden-only",
      );
    },
  },
);

// ── MeioNovels (meionovels.com) ──────────────────────────────────────────
// Hand-written placeholder fixtures that copy only the page structure.
const MN_SERIES_PAGE = `
  <html><head>
    <meta property="og:image" content="https://meionovels.com/wp-content/uploads/sample.jpg">
  </head><body>
    <h1>
    Sample Novel   </h1>
    <div class="author-content">
      <a href="https://meionovels.com/novel-author/sample-author/" rel="tag">Sample Author</a>
    </div>
    <div class="description-summary">
      <div class="summary__content show-more">
        <p>A placeholder synopsis line.</p>
      </div>
    </div>
    <a href="https://meionovels.com/novel/sample/mtl/chapter-1/" id="btn-read-first" class="c-btn">Read First</a>
  </body></html>
`;

const MN_CHAPTER_PAGE = `
  <html><body>
    <h1 id="chapter-heading">
Sample Novel - MTL - Chapter 1      </h1>
    <div class="reading-content">
      <input type="hidden" id="wp-manga-current-chap" value="chapter-1">
      <div class="text-left">
        <p>Placeholder paragraph one.</p>
        <p>Placeholder paragraph two.</p>
      </div>
    </div>
    <a href="https://meionovels.com/novel/sample/mtl/chapter-2/" class="btn next_page" title="Chapter 2">Next</a>
  </body></html>
`;

checks.push(
  {
    name: "meionovels: series page yields title, author, cover, synopsis, first chapter",
    run: () => {
      const meta = parseMeioNovelsMeta(
        MN_SERIES_PAGE,
        "https://meionovels.com/novel/sample/",
      );
      assert(meta.title === "Sample Novel", `title: ${meta.title}`);
      assert(meta.author === "Sample Author", `author: ${meta.author}`);
      assert(
        meta.coverUrl ===
          "https://meionovels.com/wp-content/uploads/sample.jpg",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis === "A placeholder synopsis line.",
        `synopsis: ${meta.synopsis}`,
      );
      assert(
        meta.firstChapterUrl ===
          "https://meionovels.com/novel/sample/mtl/chapter-1/",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "meionovels: chapter page yields title, paragraphs and next chapter",
    run: () => {
      const ch = parseMeioNovelsChapter(
        MN_CHAPTER_PAGE,
        "https://meionovels.com/novel/sample/mtl/chapter-1/",
      );
      assert(
        ch.title === "Sample Novel - MTL - Chapter 1",
        `title: ${ch.title}`,
      );
      assert(
        ch.content ===
          "Placeholder paragraph one.\n\nPlaceholder paragraph two.",
        `content: ${JSON.stringify(ch.content)}`,
      );
      assert(
        ch.nextUrl === "https://meionovels.com/novel/sample/mtl/chapter-2/",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "meionovels: canHandle and registry routing with WebView tier",
    run: () => {
      assert(
        meioNovelsScraper.canHandle("https://meionovels.com/novel/btth/"),
        "meionovels.com should match",
      );
      assert(
        !meioNovelsScraper.canHandle("https://meionovels.com.evil.example/x"),
        "lookalike host should not match",
      );
      const found = findExternalScraper("https://meionovels.com/novel/btth/");
      assert(
        found?.id === "meionovels",
        `registry returned: ${found?.id ?? "null"}`,
      );
      assert(
        needsWebView("https://meionovels.com/novel/btth/"),
        "meionovels.com should use the WebView tier",
      );
    },
  },
);

// ── LightNovelWorld.net ──────────────────────────────────────────────────
// Hand-written placeholder fixtures that copy only the page structure.
const LNW_SERIES_PAGE = `
  <html><head>
    <meta property="og:image" content="https://lightnovelworld.net/wp-content/uploads/sample.webp">
  </head><body>
    <h1 class="entry-title" itemprop="name">Sample
Novel</h1>
    <div class="serl"><span class="sername">Author</span><span class="serval"><a href="https://lightnovelworld.net/writer/sample-author/" rel="tag">Sample Author</a>, <a href="https://lightnovelworld.net/writer/other/" rel="tag">Other Name</a></span></div>
    <div class="sersys entry-content" itemprop="description"><p>A placeholder synopsis line.</p></div>
    <div class="inepcx"><a href="https://lightnovelworld.net/sample-novel-chapter-1/"><span>First Chapter</span><span class="epcur epcurfirst">Vol. 1 Ch. 1</span></a></div>
  </body></html>
`;

const LNW_CHAPTER_PAGE = `
  <html><body>
    <div class="epcontent entry-content" itemprop="text">
      <p><em>Promo line outside the chapter body.</em></p>
      <h3>Chapter 1 &#8211; Placeholder Title</h3>
      <div class="novel-content">
        <p class="chapter-paragraph">Placeholder paragraph one.</p>
        <p class="chapter-paragraph">Placeholder paragraph two.</p>
      </div>
    </div>
    <div class="bottomnav"><a aria-label="next" href="https://lightnovelworld.net/sample-novel-chapter-2/" rel="next">Next</a></div>
  </body></html>
`;

checks.push(
  {
    name: "lightnovelworldnet: series page yields title, author, cover, synopsis, first chapter",
    run: () => {
      const meta = parseLightNovelWorldNetMeta(
        LNW_SERIES_PAGE,
        "https://lightnovelworld.net/novel/sample-novel/",
      );
      assert(meta.title === "Sample Novel", `title: ${meta.title}`);
      assert(
        meta.author === "Sample Author, Other Name",
        `author: ${meta.author}`,
      );
      assert(
        meta.coverUrl ===
          "https://lightnovelworld.net/wp-content/uploads/sample.webp",
        `cover: ${meta.coverUrl}`,
      );
      assert(
        meta.synopsis === "A placeholder synopsis line.",
        `synopsis: ${meta.synopsis}`,
      );
      assert(
        meta.firstChapterUrl ===
          "https://lightnovelworld.net/sample-novel-chapter-1/",
        `firstChapterUrl: ${meta.firstChapterUrl}`,
      );
    },
  },
  {
    name: "lightnovelworldnet: chapter page yields title, chapter paragraphs and next",
    run: () => {
      const ch = parseLightNovelWorldNetChapter(
        LNW_CHAPTER_PAGE,
        "https://lightnovelworld.net/sample-novel-chapter-1/",
      );
      assert(
        ch.title === "Chapter 1 – Placeholder Title",
        `title: ${ch.title}`,
      );
      assert(
        ch.content ===
          "Placeholder paragraph one.\n\nPlaceholder paragraph two.",
        `content: ${JSON.stringify(ch.content)}`,
      );
      assert(
        ch.nextUrl === "https://lightnovelworld.net/sample-novel-chapter-2/",
        `nextUrl: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "lightnovelworldnet: canHandle accepts only lightnovelworld.net",
    run: () => {
      assert(
        lightNovelWorldNetScraper.canHandle(
          "https://lightnovelworld.net/novel/x/",
        ),
        "lightnovelworld.net should match",
      );
      assert(
        !lightNovelWorldNetScraper.canHandle(
          "https://lightnovelworld.org/novel/x/",
        ),
        ".org should not match",
      );
    },
  },
);

// ── MTL-Novel (mtl-novel.com) ────────────────────────────────────────────
// Placeholder fixtures that copy only the page structure (Madara-like novel
// info table, lazy-loaded cover, chapter reader), not any real novel text.
const MTL_NOVEL_PAGE = `
  <h1 class="entry-title">Sample Novel</h1>
  <img data-lazyloaded="1" src="data:image/gif;base64,R0lGOD" width="225" data-src="https://mtl-novel.com/wp-content/uploads/2026/11/sample-cover.png" class="main-tmb wp-post-image" alt="">
  <div class="desc">
    <h2>Novel Summary</h2>
    <p>Placeholder synopsis line one.</p>
    <p>Placeholder synopsis line two.</p>
  </div>
  <table class="info">
    <tr><td class="tbl-lbl">Titles</td><td>Sample Title</td></tr>
    <tr class="odd"><td class="tbl-lbl">Author</td><td>
      Sample Author
    </td></tr>
  </table>
  <a class="but" href="https://mtl-novel.com/novel/sample-novel/chapter-1-opening/">Start Reading</a>
`;

const MTL_NOVEL_CHAPTER = `
  <h1 class="main-title">Chapter 1: Opening</h1>
  <div class="par" id="chapter-par">
    <p>Placeholder paragraph one.</p>
    <p>Placeholder paragraph two.</p>
  </div>
  <nav class="chapter-nav">
    <span class="prev disabled">&laquo; Prev</span>
    <a class="next" href="https://mtl-novel.com/novel/sample-novel/chapter-2-next/">Next &raquo;</a>
  </nav>
`;

checks.push(
  {
    name: "mtl-novel: novel page yields title, author, lazy cover, synopsis, first chapter",
    run: () => {
      const m = parseMtlNovelMeta(
        MTL_NOVEL_PAGE,
        "https://mtl-novel.com/novel/sample-novel/",
      );
      assert(m.title === "Sample Novel", `title: ${m.title}`);
      assert(m.author === "Sample Author", `author: ${m.author}`);
      assert(
        m.coverUrl ===
          "https://mtl-novel.com/wp-content/uploads/2026/11/sample-cover.png",
        `cover: ${m.coverUrl}`,
      );
      assert(
        m.synopsis.includes("Placeholder synopsis line one."),
        "synopsis missing",
      );
      assert(
        m.firstChapterUrl ===
          "https://mtl-novel.com/novel/sample-novel/chapter-1-opening/",
        `first: ${m.firstChapterUrl}`,
      );
    },
  },
  {
    name: "mtl-novel: chapter page yields title, paragraphs and next chapter",
    run: () => {
      const ch = parseMtlNovelChapter(
        MTL_NOVEL_CHAPTER,
        "https://mtl-novel.com/novel/sample-novel/chapter-1-opening/",
      );
      assert(ch.title === "Chapter 1: Opening", `title: ${ch.title}`);
      assert(
        ch.content.includes("Placeholder paragraph two."),
        "paragraphs missing",
      );
      assert(
        ch.nextUrl ===
          "https://mtl-novel.com/novel/sample-novel/chapter-2-next/",
        `next: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "mtl-novel: canHandle accepts mtl-novel.com only, not mtlnovel.me",
    run: () => {
      assert(
        mtlNovelScraper.canHandle("https://mtl-novel.com/novel/x/"),
        "should match",
      );
      assert(
        !mtlNovelScraper.canHandle("https://mtlnovel.me/read/x/"),
        "mtlnovel.me must not match",
      );
    },
  },
);

// ── RaNovel (ranovel.com) ───────────────────────────────────────────────
// Placeholder fixtures that copy only the Madara page structure, not real text.
const RA_NOVEL_PAGE = `
  <meta property="og:image" content="https://ranovel.com/wp-content/uploads/2025/02/sample.png"/>
  <div class="post-title"><h1> Sample Novel </h1></div>
  <div class="author-content"><a href="https://ranovel.com/novel-author/sample/" rel="tag"> Sample Author </ a></div>
  <div class="summary__content ">
    <!-- <div class="maintenance-notice"><p>Maintenance notice</p></div> -->
    <p>Placeholder synopsis line one.</p>
    <p>Only Ran(o)vel dot com placeholder watermark</p>
    <p>* * * * *</p>
  </div>
  <a href="#" id="btn-read-last" class="c-btn c-btn_style-1"> Read First</a>
`;

const RA_CHAPTER = `
  <h1 id="chapter-heading">Sample Novel - Chapter 1</h1>
  <div class="reading-content">
    <p>Placeholder paragraph one.</p>
    <p>Only Ran(o)vel dot com placeholder watermark</p>
    <p>Placeholder paragraph two.</p>
  </div>
  <div class="select-pagination"><div class="nav-next"><a href="https://ranovel.com/novel/sample-novel/chapter-2/" class="btn next_page" title="Chapter 2">Next</a></div></div>
`;

checks.push(
  {
    name: "ranovel: novel page yields title, author, cover, synopsis without watermark, chapter 1 URL",
    run: () => {
      const u = "https://ranovel.com/novel/sample-novel/";
      const m = parseRaNovelMeta(RA_NOVEL_PAGE, u);
      assert(m.title === "Sample Novel", `title: ${m.title}`);
      assert(m.author === "Sample Author", `author: ${m.author}`);
      assert(m.coverUrl.endsWith("sample.png"), `cover: ${m.coverUrl}`);
      assert(
        m.synopsis.includes("Placeholder synopsis line one."),
        "synopsis missing",
      );
      assert(
        !m.synopsis.includes("Ran(o)vel") &&
          !m.synopsis.includes("maintenance"),
        "watermark or comment leaked",
      );
      assert(
        m.firstChapterUrl ===
          "https://ranovel.com/novel/sample-novel/chapter-1/",
        `first: ${m.firstChapterUrl}`,
      );
    },
  },
  {
    name: "ranovel: chapter page yields title, clean paragraphs and next chapter",
    run: () => {
      const ch = parseRaNovelChapter(
        RA_CHAPTER,
        "https://ranovel.com/novel/sample-novel/chapter-1/",
      );
      assert(ch.title === "Sample Novel - Chapter 1", `title: ${ch.title}`);
      assert(
        ch.content.includes("Placeholder paragraph two."),
        "paragraphs missing",
      );
      assert(!ch.content.includes("Ran(o)vel"), "watermark leaked");
      assert(
        ch.nextUrl === "https://ranovel.com/novel/sample-novel/chapter-2/",
        `next: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "ranovel: canHandle accepts ranovel.com only and WebView tier is enabled",
    run: () => {
      assert(
        raNovelScraper.canHandle("https://ranovel.com/novel/x/"),
        "should match",
      );
      assert(
        !raNovelScraper.canHandle("https://ranovel.org/novel/x/"),
        "other domain must not match",
      );
      assert(
        needsWebView("https://ranovel.com/novel/x/"),
        "ranovel.com should use the WebView tier",
      );
    },
  },
);

// ── Jaomix (jaomix.ru), ported from LNReader ─────────────────────────────
const JAOMIX_NOVEL = `
  <div class="desc-book"><h1>Sample Novel</h1></div>
  <div class="img-book"><img src="https://jaomix.ru/wp-content/uploads/sample.jpg"></div>
  <div id="info-book"><p>Автор: Sample Author</p><p>Статус: продолжается</p></div>
  <div id="desc-tab"><p>Placeholder synopsis.</p></div>
  <div class="title"><a href="https://jaomix.ru/sample-novel/glava-1/" title="Глава 1">Глава 1</a></div>
`;
const JAOMIX_CHAPTER = `
  <h1>Глава 1</h1>
  <div class="entry-content entry"><p>Placeholder paragraph.</p></div>
  <select><option value="https://jaomix.ru/sample-novel/glava-2/">Глава 2</option><option value="https://jaomix.ru/sample-novel/glava-1/">Глава 1</option></select>
`;

checks.push(
  {
    name: "jaomix: novel page yields title, Russian-labelled author, synopsis, first chapter",
    run: () => {
      const m = parseJaomixMeta(
        JAOMIX_NOVEL,
        "https://jaomix.ru/sample-novel/",
      );
      assert(m.title === "Sample Novel", `title: ${m.title}`);
      assert(m.author === "Sample Author", `author: ${m.author}`);
      assert(m.synopsis.includes("Placeholder synopsis."), "synopsis missing");
      assert(
        m.firstChapterUrl === null,
        "novel page alone should not invent chapter 1",
      );
    },
  },
  {
    name: "jaomix: chapter page yields title, paragraphs and next link",
    run: () => {
      const ch = parseJaomixChapter(
        JAOMIX_CHAPTER,
        "https://jaomix.ru/sample-novel/glava-1/",
      );
      assert(
        ch.content.includes("Placeholder paragraph."),
        "paragraph missing",
      );
      assert(
        ch.nextUrl === "https://jaomix.ru/sample-novel/glava-2/",
        `next: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "jaomix: chapter 1 is the last option of the newest-first dropdown",
    run: () => {
      const page = `<select id="font-size"><option value="12">12</option></select>
        <select><option value="https://jaomix.ru/sample-novel/glava-3/">Глава 3</option><option value="https://jaomix.ru/sample-novel/glava-2/">Глава 2</option><option value="https://jaomix.ru/sample-novel/glava-1/">Глава 1</option></select>`;
      assert(
        parseJaomixFirstChapter(page) ===
          "https://jaomix.ru/sample-novel/glava-1/",
        "chapter 1 not found",
      );
      const ch = parseJaomixChapter(
        `<h1 class="entry-title">Глава 2</h1>${page}<div class="entry-content entry"><p>Текст.</p></div>`,
        "https://jaomix.ru/sample-novel/glava-2/",
      );
      assert(
        ch.nextUrl === "https://jaomix.ru/sample-novel/glava-3/",
        `next: ${ch.nextUrl}`,
      );
    },
  },
  {
    name: "jaomix: canHandle accepts jaomix.ru only",
    run: () => {
      assert(
        jaomixScraper.canHandle("https://jaomix.ru/sample-novel/"),
        "should match",
      );
      assert(
        !jaomixScraper.canHandle("https://jaomix.org/x/"),
        "other domain must not match",
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
