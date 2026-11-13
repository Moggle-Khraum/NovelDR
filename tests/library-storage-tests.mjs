// Phase 3c tests: library-model storage estimate, against the real lib/storageStats.ts.
import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib/storageStats.ts";
const BUILD = "/home/claude/phase3c/build";
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, "storageStats.ts"), fs.readFileSync(SRC, "utf8"));
const S = await import(path.join(BUILD, "storageStats.ts"));

// Fake filesystem: map of file path -> size. Folders are implied by files.
function fakeFs(files, opts = {}) {
  const norm = (p) => p.replace(/\/+$/, "");
  const dirs = new Set();
  for (const f of Object.keys(files)) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const fail = opts.fail ?? new Set();
  const loopPrefix = opts.loopPrefix ?? null;
  const statCalls = [];
  const adapter = {
    statCalls,
    async stat(p) {
      const n = norm(p);
      statCalls.push(n);
      if (fail.has(n)) throw new Error("EACCES " + n);
      if (loopPrefix && (n === loopPrefix || n.startsWith(loopPrefix + "/"))) return { exists: true, isDirectory: true, size: 0 };
      if (n in files) return { exists: true, isDirectory: false, size: files[n] };
      if (dirs.has(n)) return { exists: true, isDirectory: true, size: 0 };
      return { exists: false, isDirectory: false, size: 0 };
    },
    async list(p) {
      const n = norm(p);
      if (fail.has(n)) throw new Error("EACCES " + n);
      if (loopPrefix && (n === loopPrefix || n.startsWith(loopPrefix + "/"))) return ["x"];
      const names = new Set();
      for (const f of Object.keys(files)) if (f.startsWith(n + "/")) names.add(f.slice(n.length + 1).split("/")[0]);
      return [...names];
    },
  };
  return adapter;
}

const APP = "/doc/NovelDR";
const LOCATIONS = {
  appDataDir: `${APP}/`,
  coversDir: "/doc/covers/",
  backupsDir: "/doc/noveldrr-backups/",
  exportsDir: "/doc/exports/",
  updatesDir: "/doc/updates/",   // missing on purpose
};
const NOVELS = [
  { id: "n1", title: "Alpha", chapterCount: 3 },
  { id: "n2", title: "Beta", chapterCount: 1 },
  { id: "n3", title: "Gamma", chapterCount: 2 },   // folder does not exist
];
const FILES = {
  [`${APP}/chapters/n1/chapter_0.json`]: 1000,
  [`${APP}/chapters/n1/chapter_1.json`]: 2000,
  [`${APP}/chapters/n2/chapter_0.json`]: 500,
  [`${APP}/chapters/n2/chapter_7.json`]: 300,           // not expected by the library
  [`${APP}/chapters/orphan9/chapter_0.json`]: 250,      // no novel with this id
  [`${APP}/chapters/orphan9/meta.txt`]: 50,
  [`${APP}/novels/n1.json`]: 100,
  [`${APP}/novels/n2.json`]: 50,
  [`${APP}/novels/n3.json`]: 40,
  [`${APP}/novel_library_v1.json`]: 70,
  [`${APP}/custom_fonts/f.ttf`]: 4000,
  ["/doc/covers/c1.jpg"]: 900,
  ["/doc/noveldrr-backups/b1.zip"]: 5000,
  ["/doc/exports/e.epub"]: 1200,
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};
const cat = (r, key) => r.categories.find((c) => c.key === key);

// 1. Totals by hand (see the test notes in the README).
{
  const r = await S.estimateLibraryStorage(fakeFs(FILES), { novels: NOVELS, locations: LOCATIONS });
  check("chapter text = 1000+2000+500 = 3500", cat(r, "chapters").bytes === 3500, JSON.stringify(cat(r, "chapters")));
  check("novel details = 100+50+40 = 190", cat(r, "novelDetails").bytes === 190);
  check("leftovers = 300 (unexpected chapter_7) + 300 (orphan folder) = 600", cat(r, "leftovers").bytes === 600, JSON.stringify(cat(r, "leftovers")));
  check("covers 900, backups 5000, exports 1200", cat(r, "covers").bytes === 900 && cat(r, "backups").bytes === 5000 && cat(r, "exports").bytes === 1200);
  check("updates folder missing counts as zero", cat(r, "updates").bytes === 0);
  check("other app data = 70 + 4000 = 4070", cat(r, "otherAppData").bytes === 4070, JSON.stringify(cat(r, "otherAppData")));
  check("total = 15460 bytes, each file counted once", r.totalBytes === 15460, `got ${r.totalBytes}`);
  check("present chapter files = 3", r.chapterFiles === 3, `got ${r.chapterFiles}`);
  check("missing chapter files = 3 (n1: 1, n3: 2)", r.missingChapterFiles === 3, `got ${r.missingChapterFiles}`);
  check("leftover files = 3 (chapter_7, and 2 inside orphan folder)", r.leftoverFiles === 3, `got ${r.leftoverFiles}`);
  check("orphan folders = 1", r.orphanFolders === 1, `got ${r.orphanFolders}`);
  check("no skipped folders in a healthy library", r.skipped === 0, `got ${r.skipped}`);
}

// 2. Per-novel figures: chapters + leftovers in its folder + its details file.
{
  const r = await S.estimateLibraryStorage(fakeFs(FILES), { novels: NOVELS, locations: LOCATIONS });
  const byId = Object.fromEntries(r.novels.map((n) => [n.id, n]));
  check("n1 = 3000 chapters + 100 details = 3100, 1 missing", byId.n1.bytes === 3100 && byId.n1.missingChapters === 1, JSON.stringify(byId.n1));
  check("n2 = 500 + 300 leftover + 50 details = 850, 0 missing", byId.n2.bytes === 850 && byId.n2.missingChapters === 0, JSON.stringify(byId.n2));
  check("n3 = 40 details only, 2 missing (folder absent)", byId.n3.bytes === 40 && byId.n3.missingChapters === 2, JSON.stringify(byId.n3));
  check("novels sorted largest first", r.novels.map((n) => n.id).join(",") === "n1,n2,n3", r.novels.map((n) => n.id).join(","));
  check("titles come from the library list", byId.n1.title === "Alpha" && byId.n3.title === "Gamma");
  const reconciled = r.novels.reduce((s, n) => s + n.bytes, 0) + 300 + 900 + 5000 + 1200 + 4070;
  check("novel totals + orphan + covers + backups + exports + other = total", reconciled === r.totalBytes, `${reconciled} vs ${r.totalBytes}`);
}

// 3. Missing chapter files are not stat'ed (the library already says they are absent).
{
  const adapter = fakeFs(FILES);
  await S.estimateLibraryStorage(adapter, { novels: NOVELS, locations: LOCATIONS });
  check("no stat call for a chapter file the library expects but that is absent",
    !adapter.statCalls.includes(`${APP}/chapters/n3/chapter_0.json`) && !adapter.statCalls.includes(`${APP}/chapters/n1/chapter_2.json`));
}

// 4. A chapter folder that exists but cannot be read is reported as skipped.
{
  const r = await S.estimateLibraryStorage(fakeFs(FILES, { fail: new Set(["/doc/exports"]) }), { novels: NOVELS, locations: LOCATIONS });
  check("unreadable exports folder: skipped >= 1", r.skipped >= 1, `skipped=${r.skipped}`);
  check("unreadable exports folder contributes zero", cat(r, "exports").bytes === 0);
  check("other folders still measured", cat(r, "backups").bytes === 5000);
}

// 5. A stray file in the chapters folder is a leftover, not an orphan folder.
{
  const files = { ...FILES, [`${APP}/chapters/stray.txt`]: 111 };
  const r = await S.estimateLibraryStorage(fakeFs(files), { novels: NOVELS, locations: LOCATIONS });
  check("stray file adds to leftovers (600 + 111 = 711)", cat(r, "leftovers").bytes === 711, JSON.stringify(cat(r, "leftovers")));
  check("stray file is not counted as an orphan folder", r.orphanFolders === 1, `got ${r.orphanFolders}`);
}

// 6. An endless folder structure stops at the depth cap.
{
  const adapter = fakeFs(FILES, { loopPrefix: `${APP}/chapters/loopy` });
  const files = { ...FILES, [`${APP}/chapters/loopy/a`]: 1 };
  const r = await S.estimateLibraryStorage(fakeFs(files, { loopPrefix: `${APP}/chapters/loopy` }), { novels: NOVELS, locations: LOCATIONS });
  check("depth-capped loop terminates and reports skipped", r.skipped >= 1, `skipped=${r.skipped}`);
}

// 7. Empty install: nothing on disk, every expected chapter is missing, no skips.
{
  const r = await S.estimateLibraryStorage(fakeFs({}), { novels: NOVELS, locations: LOCATIONS });
  check("empty install: total 0", r.totalBytes === 0, `got ${r.totalBytes}`);
  check("empty install: all 6 expected chapters reported missing", r.missingChapterFiles === 6, `got ${r.missingChapterFiles}`);
  check("empty install: no skipped folders", r.skipped === 0, `got ${r.skipped}`);
}

// 8. Byte formatting (unchanged from before).
for (const [input, expected] of [
  [0, "0 B"], [512, "512 B"], [1024, "1.0 KB"], [1536, "1.5 KB"],
  [1048576, "1.0 MB"], [1610612736, "1.5 GB"], [-5, "0 B"], [NaN, "0 B"],
]) {
  const got = S.formatBytes(input);
  check(`formatBytes(${input}) = "${expected}"`, got === expected, `got "${got}"`);
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
