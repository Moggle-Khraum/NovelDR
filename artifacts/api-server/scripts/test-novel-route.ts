import {
  ALLOWED_HOSTS,
  detectSite,
  extractChapterContent,
  extractChapterTitle,
  extractNextChapterUrl,
  isAllowedNovelUrl,
} from "../src/routes/novel.ts";

type Check = { name: string; run: () => void };
const checks: Check[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

checks.push({
  name: "allowlist: accepts every configured source domain",
  run: () => {
    for (const host of ALLOWED_HOSTS) {
      assert(
        isAllowedNovelUrl(`https://${host}/novel/example`),
        `expected configured host to be allowed: ${host}`,
      );
    }
  },
});

checks.push(
  {
    name: "allowlist: accepts real subdomains",
    run: () => {
      assert(
        isAllowedNovelUrl("https://www.novelping.com/book/example"),
        "expected www subdomain to be allowed",
      );
    },
  },
  {
    name: "allowlist: rejects lookalike suffix domains",
    run: () => {
      assert(
        !isAllowedNovelUrl("https://novelping.com.attacker.example/book/example"),
        "must reject a lookalike domain",
      );
    },
  },
  {
    name: "allowlist: rejects unsupported schemes",
    run: () => {
      assert(
        !isAllowedNovelUrl("javascript://novelping.com/chapter-1"),
        "must reject non-HTTP schemes",
      );
    },
  },
  {
    name: "allowlist: rejects URLs containing credentials",
    run: () => {
      assert(
        !isAllowedNovelUrl("https://user:pass@novelping.com/book/example"),
        "must reject URLs containing embedded credentials",
      );
    },
  },
  {
    name: "site detection: uses the hostname, not arbitrary URL text",
    run: () => {
      const result = detectSite(
        "https://example.org/readnovelfull.com/chapter-1",
      );
      assert(
        !result.isReadNovelFull && !result.isNovelFull,
        "a source name in the path must not change host detection",
      );
    },
  },
  {
    name: "site detection: detects chapter paths without matching query strings",
    run: () => {
      const chapter = detectSite("https://novelfull.com/book/chapter-12.html");
      const novel = detectSite(
        "https://novelfull.com/book?next=chapter-12",
      );
      assert(chapter.isChapterPage, "expected chapter path to be detected");
      assert(!novel.isChapterPage, "query text must not mark a novel page as a chapter");
    },
  },
  {
    name: "chapter content: extracts <p>-based chapter content",
    run: () => {
      const result = extractChapterContent(
        '<div id="chapter-content"><p>First paragraph.</p><p>Second paragraph.</p></div>',
      );
      assert(
        result === "First paragraph.\n\nSecond paragraph.",
        `unexpected paragraph extraction: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "chapter content: extracts Novel-bin bare <br> content and drops repeated title",
    run: () => {
      const result = extractChapterContent(`
        <div id="chr-content">
          <p></p>
          <h4>Chapter 12: The Water Mansion</h4>
          Chen Mobai stepped through the gate.<br>
          The air shimmered with spirit energy.<br><br>
          He walked on.
        </div>
        <p>Next Chapter</p>
      `);
      assert(
        result.includes("Chen Mobai stepped through the gate.") &&
          result.includes("The air shimmered with spirit energy.") &&
          !result.includes("Water Mansion") &&
          !result.includes("Next Chapter"),
        `unexpected br-based extraction: ${JSON.stringify(result)}`,
      );
    },
  },
  {
    name: "chapter content: does not mistake navigation paragraphs for content",
    run: () => {
      assert(
        extractChapterContent('<div id="chapter-content"><p>Next Chapter</p></div>') === "",
        "expected navigation-only block to return empty content",
      );
    },
  },
  {
    name: "chapter title: preserves heading text and normalizes chapter number",
    run: () => {
      const title = extractChapterTitle(
        '<h1 class="chapter-title">Chapter 1: Reborn as an Ancient Tree</h1>',
        1,
      );
      assert(
        title === "Chapter 1: Reborn as an Ancient Tree",
        `unexpected title: ${title}`,
      );
    },
  },
  {
    name: "next chapter: extracts a supported relative URL",
    run: () => {
      const next = extractNextChapterUrl(
        '<a id="next_chap" class="next" href="/book/example/chapter-2">Next Chapter</a>',
        "https://novel-bin.com/book/example/chapter-1",
      );
      assert(
        next === "https://novel-bin.com/book/example/chapter-2",
        `unexpected next URL: ${next}`,
      );
    },
  },
  {
    name: "next chapter: ignores disabled last-chapter links",
    run: () => {
      const next = extractNextChapterUrl(
        '<a id="next_chap" class="next" disabled="" href="/book/example/chapter-2">Next Chapter</a>',
        "https://novel-bin.com/book/example/chapter-1",
      );
      assert(next === null, `expected disabled link to be ignored, got: ${next}`);
    },
  },
  {
    name: "next chapter: rejects external destinations",
    run: () => {
      const next = extractNextChapterUrl(
        '<a class="next" href="https://attacker.example/chapter-2">Next Chapter</a>',
        "https://novel-bin.com/book/example/chapter-1",
      );
      assert(next === null, `expected external URL to be rejected, got: ${next}`);
    },
  },
);

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`  ok  ${check.name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${check.name}`);
    console.error(`      ${(error as Error).message}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) process.exit(1);
