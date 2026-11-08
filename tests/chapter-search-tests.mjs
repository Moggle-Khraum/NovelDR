// Phase 3a tests: chapter-title search. Runs the real lib/chapterSearch.ts.
import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib/chapterSearch.ts";
const BUILD = "/home/claude/phase3/build";
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, "chapterSearch.ts"), fs.readFileSync(SRC, "utf8"));
const m = await import(path.join(BUILD, "chapterSearch.ts"));
const titles = (list) => list.map((c) => c.title);
const chapters = [
  { title: "Prologue" },
  { title: "Chapter 1" },
  { title: "Chapter 1.5" },
  { title: "Chapter 9: The Storm" },
  { title: "Chapter 10" },
  { title: "Chapter 11: Café Dawn" },
  { title: "Chapter V" },
  { title: "Interlude: A Quiet Afternoon" },
  { title: undefined },
];
let failures = 0;
const check = (name, got, expect) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got ${JSON.stringify(got)}\n      exp ${JSON.stringify(expect)}`}`);
};
const q = (s) => titles(m.filterChaptersByTitle(chapters, s));

check("empty query returns all, in order", q(""), titles(chapters));
check("whitespace-only query returns all", q("   "), titles(chapters));
check("punctuation-only query returns all", q(" : , "), titles(chapters));
check("'chapter 1' is whole-number: not Chapter 10 or 1.5", q("chapter 1"), ["Chapter 1"]);
check("'10' finds only Chapter 10", q("10"), ["Chapter 10"]);
check("'1.5' finds only Chapter 1.5", q("1.5"), ["Chapter 1.5"]);
check("'storm' matches a word inside the title", q("storm"), ["Chapter 9: The Storm"]);
check("case-insensitive", q("STORM"), ["Chapter 9: The Storm"]);
check("prefix of a word: 'chap' finds chapters", q("chap"), ["Chapter 1", "Chapter 1.5", "Chapter 9: The Storm", "Chapter 10", "Chapter 11: Café Dawn", "Chapter V"]);
check("prefix: 'stor' finds The Storm", q("stor"), ["Chapter 9: The Storm"]);
check("all terms must match: 'chapter storm'", q("chapter storm"), ["Chapter 9: The Storm"]);
check("two terms with no common chapter: none", q("storm dawn"), []);
check("no match returns empty list", q("zzzz"), []);
check("accented title matched by accented query", q("café"), ["Chapter 11: Café Dawn"]);
check("untitled chapter never matches a text query", q("prologue"), ["Prologue"]);
check("Roman numeral chapter matched by 'v'", q("v"), ["Chapter V"]);
check("colon and punctuation in query are ignored", q("storm:"), ["Chapter 9: The Storm"]);
check("'quiet' inside an interlude title", q("quiet afternoon"), ["Interlude: A Quiet Afternoon"]);
check("'chapter 11' finds 11 only, not 1 or 10", q("chapter 11"), ["Chapter 11: Café Dawn"]);
check("order is preserved", q("chapter"), ["Chapter 1", "Chapter 1.5", "Chapter 9: The Storm", "Chapter 10", "Chapter 11: Café Dawn", "Chapter V"]);
check("input array is not mutated", (() => { const copy = JSON.stringify(chapters); m.filterChaptersByTitle(chapters, "storm"); return JSON.stringify(chapters) === copy; })() ? ["ok"] : ["mutated"], ["ok"]);
console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
