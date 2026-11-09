// Phase 1 tests. Runs the real lib modules under Node's TypeScript strip mode.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LIB = "/home/claude/noveldr-audit/artifacts/novel-reader/lib";
const TMP = "/home/claude/phase1/build";
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
for (const f of ["chapterOrder.ts", "exportChapters.ts"]) {
  let src = fs.readFileSync(path.join(LIB, f), "utf8");
  src = src.replace(/from "\.\/chapterOrder"/g, 'from "./chapterOrder.ts"');
  fs.writeFileSync(path.join(TMP, f), src);
}
const order = await import(path.join(TMP, "chapterOrder.ts"));
const exp = await import(path.join(TMP, "exportChapters.ts"));

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};
const titles = (list) => list.map((c) => c.title).join(" | ");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 1. Number parsing ----------
const parseCases = [
  ["Chapter 1", 1],
  ["Chapter 12", 12],
  ["Chapter 1.5", 1.5],
  ["Chapter V", 5],
  ["Chapter IX: The Storm", 9],
  ["Chapter XIV", 14],
  ["Volume 2 Chapter 5", 5],
  ["#12 Title", 12],
  ["Prologue", null],
  ["Interlude", null],
  ["Extra", null],
  ["Afterword", null],
  ["Chapter IIII", null],   // non-canonical numeral
  ["Chapter VX", null],     // non-canonical numeral
  ["", null],
];
for (const [title, expected] of parseCases) {
  const got = order.parseChapterNumber(title);
  check(`parse "${title}" -> ${expected}`, got === expected, `got ${got}`);
}

// ---------- 2. Reading order ----------
const ch = (t) => ({ title: t, url: "/" + t.toLowerCase().replace(/\W+/g, "-") });
const orderCases = [
  {
    name: "user example: Prologue,1-4,V,6,7",
    input: ["Prologue", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter V", "Chapter 6", "Chapter 7"],
    expect: ["Prologue", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter V", "Chapter 6", "Chapter 7"],
  },
  {
    name: "extra downloaded after chapter 2 stays there",
    input: ["Chapter 1", "Chapter 2", "Extra", "Chapter 3"],
    expect: ["Chapter 1", "Chapter 2", "Extra", "Chapter 3"],
  },
  {
    name: "afterword at end stays at end",
    input: ["Chapter 1", "Chapter 2", "Chapter 3", "Afterword"],
    expect: ["Chapter 1", "Chapter 2", "Chapter 3", "Afterword"],
  },
  {
    name: "two unnumbered chapters keep their download order",
    input: ["Chapter 1", "Chapter 2", "Interlude B", "Interlude A", "Chapter 3"],
    expect: ["Chapter 1", "Chapter 2", "Interlude B", "Interlude A", "Chapter 3"],
  },
  {
    name: "prologue stays first even if stored later",
    input: ["Chapter 1", "Chapter 2", "Prologue"],
    expect: ["Prologue", "Chapter 1", "Chapter 2"],
  },
  {
    name: "out-of-order numbered chapters are sorted",
    input: ["Chapter 3", "Chapter 1", "Chapter 2"],
    expect: ["Chapter 1", "Chapter 2", "Chapter 3"],
  },
];
for (const c of orderCases) {
  const got = order.orderChapters(c.input.map(ch)).map((x) => x.title);
  check(`order: ${c.name}`, eq(got, c.expect), `got: ${got.join(" | ")}`);
}
// Idempotence: ordering an already-ordered list changes nothing.
for (const c of orderCases) {
  const once = order.orderChapters(c.input.map(ch));
  const twice = order.orderChapters(once);
  check(`idempotent: ${c.name}`, eq(once.map((x) => x.url), twice.map((x) => x.url)));
}

// ---------- 3. Export loader ----------
// Fake storage: file i holds the chapter stored at position i.
function fakeStore(stored) {
  const files = new Map(stored.map((c, i) => [i, { title: c.title, content: `BODY of ${c.title}` }]));
  return {
    readStoredFile: async (i) => files.get(i) ?? null,
    readLegacyContent: async () => null,
    files,
  };
}
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

// D2: stored order differs from reading order. Each title must get its own body.
{
  // Simulate an old-style unsorted list: Extra stored first.
  const list = [ch("Extra"), ch("Chapter 1"), ch("Chapter 2"), ch("Chapter 3")];
  const store = fakeStore(list);
  const res = await exp.loadExportChapters(list, store.readStoredFile, store.readLegacyContent);
  const allMatch = res.chapters.every((c) => c.content === `BODY of ${c.title}`);
  check("D2: every exported title gets its own file body", allMatch, res.chapters.map((c) => `${c.title}->${c.content}`).join("; "));
  // The stored list had Extra first, and that is the only evidence of where it
  // belongs. Its original download position was lost by the old sort, so it stays
  // where the list has it. Bodies must still line up with titles (checked above).
  check("D2: order follows stored evidence (old-sort libraries keep Extra first)", titles(res.chapters) === "Extra | Chapter 1 | Chapter 2 | Chapter 3", titles(res.chapters));
  check("D2: no missing content", res.missingCount === 0);
}

// D3: unnumbered chapters are not collapsed. All of them must survive.
{
  const list = [ch("Prologue"), ch("Interlude A"), ch("Interlude B"), ch("Chapter 1"), ch("Extra"), ch("Afterword")];
  const store = fakeStore(list);
  const res = await exp.loadExportChapters(list, store.readStoredFile, store.readLegacyContent);
  check("D3: all 6 unnumbered/numbered chapters kept", res.chapters.length === 6, `kept ${res.chapters.length}`);
  check("D3: each unnumbered body present", res.chapters.every((c) => c.content === `BODY of ${c.title}`));
}

// D4: short real chapters (under 100 words) are kept.
{
  const list = [ch("Chapter 1"), ch("Chapter 2")];
  const files = new Map([
    [0, { title: "Chapter 1", content: "A short bonus chapter of only a few words." }],
    [1, { title: "Chapter 2", content: words(500) }],
  ]);
  const res = await exp.loadExportChapters(list, async (i) => files.get(i) ?? null, async () => null);
  check("D4: 9-word chapter exported with its real text", res.chapters[0].content === files.get(0).content);
  check("D4: no placeholder for short chapter", res.missingCount === 0);
}

// Missing file -> placeholder, counted; neighbours unaffected.
{
  const list = [ch("Chapter 1"), ch("Chapter 2"), ch("Chapter 3")];
  const files = new Map([
    [0, { title: "Chapter 1", content: "one" }],
    [2, { title: "Chapter 3", content: "three" }],
  ]);
  const res = await exp.loadExportChapters(list, async (i) => files.get(i) ?? null, async () => null);
  check("missing: placeholder used for chapter with no file", res.chapters[1].content === exp.MISSING_CONTENT_MESSAGE);
  check("missing: count is 1", res.missingCount === 1, `count ${res.missingCount}`);
  check("missing: neighbours still correct", res.chapters[0].content === "one" && res.chapters[2].content === "three");
}

// Legacy fallback is used when the file is absent, matched by URL.
{
  const list = [ch("Chapter 1")];
  const res = await exp.loadExportChapters(
    list,
    async () => null,
    async (url) => (url === list[0].url ? { title: "Chapter 1", content: "from legacy" } : null),
  );
  check("legacy: used when file missing", res.chapters[0].content === "from legacy");
}

// Duplicate URL: kept once, first in reading order.
{
  const list = [ch("Chapter 1"), { title: "Chapter 1 again", url: list0url() }];
  function list0url() { return ch("Chapter 1").url; }
  const files = new Map([[0, { title: "Chapter 1", content: "first" }], [1, { title: "dup", content: "second" }]]);
  const res = await exp.loadExportChapters(list, async (i) => files.get(i) ?? null, async () => null);
  check("dedupe: duplicate URL dropped", res.chapters.length === 1 && res.chapters[0].content === "first");
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
