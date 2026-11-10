// Phase 4a tests: export planning, against the real lib/exportPlan.ts.
import fs from "node:fs";
import path from "node:path";
const BUILD = "/home/claude/phase4/build";
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.copyFileSync("/home/claude/noveldr-audit/artifacts/novel-reader/lib/exportPlan.ts", path.join(BUILD, "exportPlan.ts"));
const P = await import(path.join(BUILD, "exportPlan.ts"));

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};
const mk = (n, bytes = 100_000) => Array.from({ length: n }, (_, i) => ({ index: i, title: `Chapter ${i + 1}`, bytes }));

// Threshold: 49 is standard, 50 is long.
check("49 chapters: standard mode", P.planExport(mk(49)).mode === "standard");
check("50 chapters: long mode (threshold is 50)", P.planExport(mk(50)).mode === "long");
check("150 chapters: long mode", P.planExport(mk(150)).mode === "long");
check("threshold constant is 50", P.LONG_NOVEL_CHAPTERS === 50);

// Standard: always one part, even when large.
{
  const plan = P.planExport(mk(49, 1_000_000));
  check("standard export is one part", plan.parts.length === 1 && plan.parts[0].lastChapter === 49, JSON.stringify(plan.parts.map((p) => p.lastChapter)));
}

// Empty novel.
{
  const plan = P.planExport([]);
  check("no chapters: no parts", plan.parts.length === 0 && plan.chapterCount === 0);
}

// Long: every chapter appears exactly once, in order, with contiguous ranges.
{
  const chapters = mk(120, 1_000_000);
  const plan = P.planExport(chapters, { partBudget: 6_000_000 });
  const flat = plan.parts.flatMap((p) => p.chapters.map((c) => c.index));
  check("long: every chapter appears exactly once, in reading order", flat.join(",") === chapters.map((c) => c.index).join(","));
  let contiguous = true;
  let expectFirst = 1;
  for (const p of plan.parts) {
    if (p.firstChapter !== expectFirst || p.lastChapter !== p.firstChapter + p.chapters.length - 1) contiguous = false;
    expectFirst = p.lastChapter + 1;
  }
  check("long: chapter ranges are contiguous", contiguous);
  check("long: part numbers run 1..total", plan.parts.every((p, i) => p.number === i + 1 && p.total === plan.parts.length));
}

// Long: no part exceeds the budget unless it is a single oversized chapter.
{
  const chapters = mk(80, 1_000_000);
  const budget = 6_000_000;
  const plan = P.planExport(chapters, { partBudget: budget });
  check("long: no part exceeds the budget", plan.parts.every((p) => p.bytes <= budget || p.chapters.length === 1), JSON.stringify(plan.parts.map((p) => p.bytes)));
  check("long: 80 chapters of 1 MB in a 6 MB budget give 14 parts (6+6+...+2)", plan.parts.length === 14, `got ${plan.parts.length}`);
}

// Long: a chapter larger than the budget gets a part of its own.
{
  const chapters = [
    { index: 0, title: "A", bytes: 1_000_000 },
    { index: 1, title: "Huge", bytes: 20_000_000 },
    { index: 2, title: "B", bytes: 1_000_000 },
  ];
  for (let i = 3; i < 50; i++) chapters.push({ index: i, title: `C${i}`, bytes: 100_000 });
  const plan = P.planExport(chapters, { partBudget: 6_000_000 });
  const huge = plan.parts.find((p) => p.chapters.some((c) => c.title === "Huge"));
  check("oversized chapter sits alone in its part", huge && huge.chapters.length === 1, JSON.stringify(huge && huge.chapters.map((c) => c.title)));
}

// Long: totals add up.
{
  const chapters = mk(60, 250_000);
  const plan = P.planExport(chapters);
  check("long: part bytes add up to the total", plan.parts.reduce((s, p) => s + p.bytes, 0) === plan.totalBytes && plan.totalBytes === 15_000_000);
}

// Long but small: still long mode, and a single part is fine.
{
  const plan = P.planExport(mk(50, 1_000));
  check("long mode with small chapters: one part, long mode", plan.mode === "long" && plan.parts.length === 1);
}

// Determinism.
{
  const a = JSON.stringify(P.planExport(mk(90, 900_000)));
  const b = JSON.stringify(P.planExport(mk(90, 900_000)));
  check("planning is deterministic", a === b);
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
