// Phase 4b tests: long-novel export runner, against the real lib modules.
import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib";
const BUILD = "/home/claude/phase4/build2";
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.copyFileSync(path.join(SRC, "exportPlan.ts"), path.join(BUILD, "exportPlan.ts"));
fs.writeFileSync(path.join(BUILD, "exportRunner.ts"), fs.readFileSync(path.join(SRC, "exportRunner.ts"), "utf8").replace(/from "\.\/exportPlan"/g, 'from "./exportPlan.ts"'));
const Plan = await import(path.join(BUILD, "exportPlan.ts"));
const R = await import(path.join(BUILD, "exportRunner.ts"));

const MB = 1024 * 1024;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};

// Fake device: chapters (text per position), a file store, and a zip log.
function device(opts = {}) {
  const chapters = opts.chapters ?? Array.from({ length: 60 }, (_, i) => ({ title: `Chapter ${i + 1}`, content: `Text ${i + 1} ` + "x".repeat(10) }));
  const store = new Map(); // path -> content
  const staged = new Map(); // partNumber -> [{position,title,content}]
  const log = { reads: [], discarded: [], zips: [], built: [], finished: [] };
  return {
    store, log, chapters,
    deps: {
      freeBytes: async () => opts.free ?? 500 * MB,
      readChapter: async (position) => {
        log.reads.push(position);
        if (opts.onRead) await opts.onRead(position);
        const c = chapters[position];
        if (opts.missing?.includes(position)) return null;
        return c ? { title: c.title, content: c.content } : null;
      },
      stageChapter: async (partNumber, position, title, content) => {
        if (opts.failStageAt === position) throw new Error("disk write failed");
        const list = staged.get(partNumber) ?? [];
        list.push({ position, title, content });
        staged.set(partNumber, list);
      },
      buildPart: async (partNumber, partTotal) => {
        if (opts.failBuildPart === partNumber) throw new Error("builder crashed");
        const tmp = `/tmp/part_${partNumber}.epub.partial`;
        store.set(tmp, `built ${(staged.get(partNumber) ?? []).length} chapters`);
        log.built.push(partNumber);
        return tmp;
      },
      finishPart: async (tempPath, partNumber) => {
        const finalPath = `/out/part_${partNumber}.epub`;
        store.set(finalPath, store.get(tempPath));
        store.delete(tempPath);
        log.finished.push(partNumber);
        return finalPath;
      },
      discardPart: async (partNumber) => {
        log.discarded.push(partNumber);
        staged.delete(partNumber);
        store.delete(`/tmp/part_${partNumber}.epub.partial`);
      },
      zipParts: async (files, note) => {
        if (opts.failZip) throw new Error("zip failed");
        log.zips.push({ files, note });
        return "/out/Novel_parts.zip";
      },
    },
  };
}

const planOf = (n, bytes = 1000) => {
  const chapters = Array.from({ length: n }, (_, i) => ({ index: i, title: `Chapter ${i + 1}`, bytes }));
  return Plan.planExport(chapters, { partBudget: 10 * bytes });
};
const run = (plan, dev, extra = {}) => R.runLongExport(plan, dev.deps, { isCancelled: () => false, ...extra });

// 1. Space check refuses before writing anything.
{
  const dev = device({ free: 50 * MB });
  const r = await run(planOf(60), dev);
  check("low space: refused", r.phase === "refused" && /Not enough free space/.test(r.note), JSON.stringify(r));
  check("low space: no chapters read, nothing built", dev.log.reads.length === 0 && dev.log.built.length === 0);
}

// 2. Space need is the larger of 100 MB and the estimate.
{
  check("required space: 100 MB minimum", R.requiredFreeBytes({}) === 100 * MB);
  check("required space: larger estimate wins", R.requiredFreeBytes({ estimatedOutputBytes: 300 * MB }) === 300 * MB);
}

// 3. Full run: every chapter read once, in order; every part built, finished, zipped.
{
  const dev = device();
  const plan = planOf(60);
  const r = await run(plan, dev);
  check("full run: phase done", r.phase === "done", r.phase);
  check("full run: every chapter read exactly once, in order", dev.log.reads.join(",") === Array.from({ length: 60 }, (_, i) => i).join(","));
  check("full run: every part finished", dev.log.finished.length === plan.parts.length);
  check("full run: zip made from the finished parts", r.zipPath === "/out/Novel_parts.zip" && dev.log.zips[0].files.length === plan.parts.length);
  check("full run: note says all complete", /All \d+ parts? complete\./.test(r.note), r.note);
  check("full run: nothing discarded", dev.log.discarded.length === 0);
}

// 4. Cancel mid-part: unfinished part discarded, finished parts kept and zipped.
{
  const plan = planOf(60);
  const dev = device({ onRead: null });
  let cancelled = false;
  dev.deps.readChapter = ((orig) => async (p) => { if (p === 25) cancelled = true; return orig(p); })(dev.deps.readChapter);
  const r = await run(plan, dev, { isCancelled: () => cancelled });
  check("cancel mid-part: phase cancelled", r.phase === "cancelled", r.phase);
  check("cancel mid-part: the in-progress part is discarded", dev.log.discarded.length === 1 && dev.log.discarded[0] === 3, JSON.stringify(dev.log.discarded));
  check("cancel mid-part: finished parts kept", r.completedParts.length === 2 && dev.log.finished.join(",") === "1,2", JSON.stringify(dev.log.finished));
  check("cancel mid-part: zip still made from finished parts", r.zipPath && dev.log.zips[0].files.length === 2);
  check("cancel mid-part: note names the stop and the complete parts", /Stopped at part 3 of 6/.test(r.note) && /Parts 1 to 2 are complete/.test(r.note), r.note);
}

// 5. Cancel before the first part: nothing finished, nothing zipped.
{
  const dev = device();
  const r = await run(planOf(60), dev, { isCancelled: () => true });
  check("cancel at start: phase cancelled, no zip", r.phase === "cancelled" && r.zipPath === undefined && dev.log.zips.length === 0);
  check("cancel at start: no chapters read", dev.log.reads.length === 0);
  check("cancel at start: note says nothing completed", /No parts were completed/.test(r.note), r.note);
}

// 6. A staging failure stops the run; the part is discarded; earlier parts are kept.
{
  const dev = device({ failStageAt: 15 });
  const plan = planOf(60);
  const r = await run(plan, dev);
  check("stage failure: phase failed", r.phase === "failed", r.phase);
  check("stage failure: the failed part is discarded", dev.log.discarded.includes(2));
  check("stage failure: earlier part kept and zipped", dev.log.finished.join(",") === "1" && r.zipPath);
  check("stage failure: note carries the reason", /disk write failed/.test(r.note), r.note);
  check("stage failure: later chapters never read", !dev.log.reads.includes(20));
}

// 7. A builder failure is handled like a stage failure.
{
  const dev = device({ failBuildPart: 2 });
  const r = await run(planOf(60), dev);
  check("build failure: failed, part 2 discarded, part 1 kept", r.phase === "failed" && dev.log.discarded.includes(2) && dev.log.finished.join(",") === "1");
}

// 8. Missing chapters: placeholder written, counted, export continues.
{
  const dev = device({ missing: [4, 30] });
  const r = await run(planOf(60), dev);
  check("missing chapters: counted", r.missingChapters === 2, `got ${r.missingChapters}`);
  check("missing chapters: export still completes", r.phase === "done");
}

// 9. Zip failure is reported, and the finished parts remain on disk.
{
  const dev = device({ failZip: true });
  const r = await run(planOf(60), dev);
  check("zip failure: phase failed, parts remain", r.phase === "failed" && dev.log.finished.length > 0 && r.zipPath === undefined);
}

// 10. Progress reports reach the total, and events are emitted.
{
  const dev = device();
  const progress = [];
  const events = [];
  await run(planOf(60), dev, { onProgress: (p) => progress.push(p), onEvent: (e) => events.push(e) });
  const last = progress[progress.length - 1];
  check("progress: ends in done with all chapters counted", last.phase === "done" && last.chaptersDone === 60, JSON.stringify(last));
  check("events: warnings and successes are logged", events.some((e) => e.level === "ok") && events.some((e) => e.level === "info"));
}

// 11. Notes read correctly in each case.
{
  check("note: all complete", R.buildNote({ total: 4, completed: 4 }) === "All 4 parts complete.");
  check("note: stopped after two of four", R.buildNote({ total: 4, completed: 2, stoppedAt: 3 }) === "Stopped at part 3 of 4. Parts 1 to 2 are complete.", R.buildNote({ total: 4, completed: 2, stoppedAt: 3 }));
  check("note: stopped with one part done", R.buildNote({ total: 4, completed: 1, stoppedAt: 2 }) === "Stopped at part 2 of 4. Part 1 is complete.");
  check("note: nothing finished", R.buildNote({ total: 4, completed: 0, stoppedAt: 1 }) === "Stopped at part 1 of 4. No parts were completed.");
  check("note: failure reason included", /builder crashed/.test(R.buildNote({ total: 2, completed: 0, stoppedAt: 1, reason: "builder crashed" })));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
