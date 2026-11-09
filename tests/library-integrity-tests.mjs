// Phase 3d tests: library integrity check and user-tapped removal, against the real modules.
import fs from "node:fs";
import path from "node:path";
const LIB = "/home/claude/noveldr-audit/artifacts/novel-reader/lib";
const BUILD = "/home/claude/phase3d/build";
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
for (const f of ["storageStats.ts", "libraryIntegrity.ts"]) {
  fs.writeFileSync(path.join(BUILD, f), fs.readFileSync(path.join(LIB, f), "utf8").replace(/from "\.\/storageStats"/g, 'from "./storageStats.ts"'));
}
const I = await import(path.join(BUILD, "libraryIntegrity.ts"));

function fakeFs(files, opts = {}) {
  const norm = (p) => p.replace(/\/+$/, "");
  const dirs = new Set();
  for (const f of Object.keys(files)) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const fail = opts.fail ?? new Set();
  return {
    async stat(p) {
      const n = norm(p);
      if (fail.has(n)) throw new Error("EACCES " + n);
      if (n in files) return { exists: true, isDirectory: false, size: files[n] };
      if (dirs.has(n)) return { exists: true, isDirectory: true, size: 0 };
      return { exists: false, isDirectory: false, size: 0 };
    },
    async list(p) {
      const n = norm(p);
      if (fail.has(n)) throw new Error("EACCES " + n);
      const names = new Set();
      for (const f of Object.keys(files)) if (f.startsWith(n + "/")) names.add(f.slice(n.length + 1).split("/")[0]);
      return [...names];
    },
  };
}

const APP = "/doc/NovelDR";
const NOVELS = [
  { id: "n1", title: "Alpha", chapterCount: 3 },
  { id: "n2", title: "Beta", chapterCount: 1 },
  { id: "n3", title: "Gamma", chapterCount: 2 },
];
const BASE_FILES = {
  [`${APP}/chapters/n1/chapter_0.json`]: 1000,
  [`${APP}/chapters/n1/chapter_1.json`]: 2000,
  [`${APP}/chapters/n2/chapter_0.json`]: 500,
  [`${APP}/chapters/n2/chapter_7.json`]: 300,
  [`${APP}/chapters/orphan9/chapter_0.json`]: 250,
  [`${APP}/chapters/orphan9/meta.txt`]: 50,
  [`${APP}/novels/n1.json`]: 100,
  [`${APP}/novels/n2.json`]: 50,
  [`${APP}/novels/n3.json`]: 40,
};
const INDEX = ["n1", "n2", "n3"];
const run = (files, novels = NOVELS, indexIds = INDEX, opts) =>
  I.checkLibraryIntegrity(fakeFs(files, opts), { novels, indexIds, appDataDir: `${APP}/` });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};

// 1. Counts for the base fixture, worked out by hand.
const base = await run(BASE_FILES);
check("3 missing chapter files (n1 #2; n3 #0 and #1)", base.missingChapterFiles === 3, `got ${base.missingChapterFiles}`);
check("1 leftover file (n2 chapter_7.json)", base.leftoverFiles === 1, `got ${base.leftoverFiles}`);
check("1 unlinked folder (orphan9)", base.unlinkedFolders === 1, `got ${base.unlinkedFolders}`);
check("0 items needing attention on a healthy library", base.needsAttention === 0, `got ${base.needsAttention}`);
check("novelsChecked = 3", base.novelsChecked === 3);

// 2. Missing issues say which novel and which chapter.
{
  const miss = base.issues.filter((i) => i.kind === "missingChapterFile");
  const n1 = miss.find((i) => i.novelId === "n1");
  check("missing issue names the novel, title, and chapter index", n1 && n1.title === "Alpha" && n1.chapterIndex === 2 && n1.removable === false, JSON.stringify(n1));
  check("missing issues are never removable", miss.every((i) => i.removable === false));
}

// 3. Expected chapter files are never flagged.
check("chapter_0 and chapter_1 of n1 are not flagged",
  !base.issues.some((i) => i.path === `${APP}/chapters/n1/chapter_0.json` || i.path === `${APP}/chapters/n1/chapter_1.json`));

// 4. Orphan folder with a details file is not removable (it may be a damaged novel).
{
  const files = { ...BASE_FILES, [`${APP}/novels/orphan9.json`]: 90 };
  const r = await run(files);
  const folder = r.issues.find((i) => i.path === `${APP}/chapters/orphan9`);
  check("folder with a details file: needs attention, not removable", folder && folder.kind === "needsAttention" && folder.removable === false, JSON.stringify(folder));
  check("no unlinked folder counted when the details file exists", r.unlinkedFolders === 0, `got ${r.unlinkedFolders}`);
}

// 5. Orphan folder listed in the index is not removable.
{
  const r = await run(BASE_FILES, NOVELS, [...INDEX, "orphan9"]);
  const folder = r.issues.find((i) => i.path === `${APP}/chapters/orphan9`);
  check("folder listed in the index: needs attention, not removable", folder && folder.kind === "needsAttention" && folder.removable === false, JSON.stringify(folder));
}

// 6. An interrupted re-index folder is never removed and is not a leftover.
{
  const files = { ...BASE_FILES, [`${APP}/chapters/n1/.reindex/chapter_0.json`]: 700 };
  const r = await run(files);
  const staging = r.issues.find((i) => i.path === `${APP}/chapters/n1/.reindex`);
  check(".reindex folder: needs attention, not removable", staging && staging.kind === "needsAttention" && staging.removable === false);
  check(".reindex folder is not counted as a leftover file", r.leftoverFiles === 1, `got ${r.leftoverFiles}`);
}

// 7. A loose file in the chapters folder needs attention.
{
  const files = { ...BASE_FILES, [`${APP}/chapters/stray.txt`]: 111 };
  const r = await run(files);
  const stray = r.issues.find((i) => i.path === `${APP}/chapters/stray.txt`);
  check("loose file in chapters folder: needs attention, not removable", stray && stray.kind === "needsAttention" && stray.removable === false);
}

// 8. A details file for a novel that did not load needs attention.
{
  const files = { ...BASE_FILES, [`${APP}/novels/ghost.json`]: 30 };
  const r = await run(files);
  const ghost = r.issues.find((i) => i.path === `${APP}/novels/ghost.json`);
  check("details file with no loaded novel: needs attention, not removable", ghost && ghost.kind === "needsAttention" && ghost.removable === false);
}

// 9. A loaded novel whose details file is gone needs attention.
{
  const files = { ...BASE_FILES };
  delete files[`${APP}/novels/n2.json`];
  const r = await run(files);
  check("loaded novel with no details file: needs attention", r.issues.some((i) => i.kind === "needsAttention" && i.novelId === "n2" && i.path.endsWith("n2.json")));
}

// 10. An unreadable chapter folder reports attention; nothing removable comes from it.
{
  const r = await run(BASE_FILES, NOVELS, INDEX, { fail: new Set([`${APP}/chapters/n2`]) });
  const bad = r.issues.find((i) => i.path === `${APP}/chapters/n2` && i.kind === "needsAttention");
  check("unreadable chapter folder: needs attention", !!bad);
  check("unreadable folder yields no removable leftover", !r.issues.some((i) => i.removable && i.novelId === "n2"));
}

// 11. Removal removes only removable issues, never expected chapter files.
{
  const removed = [];
  const r = await I.removeRemovableIssues(base.issues, async (p) => removed.push(p));
  check("removes exactly the leftover file and the unlinked folder", r.removed === 2 && r.failed === 0, JSON.stringify(r));
  check("removed paths are the leftover and the orphan folder only",
    removed.includes(`${APP}/chapters/n2/chapter_7.json`) && removed.includes(`${APP}/chapters/orphan9`) && removed.length === 2, JSON.stringify(removed));
  check("no expected chapter file is ever removed", !removed.some((p) => /chapter_[0-2]\.json$/.test(p) && p.includes("/n1/")));
}

// 12. Fresh-check safety: a file the library now expects is no longer a leftover.
{
  const grown = NOVELS.map((n) => (n.id === "n2" ? { ...n, chapterCount: 8 } : n));
  const fresh = await run(BASE_FILES, grown);
  const removed = [];
  await I.removeRemovableIssues(fresh.issues, async (p) => removed.push(p));
  check("a chapter the library now expects is not removed", !removed.includes(`${APP}/chapters/n2/chapter_7.json`), JSON.stringify(removed));
}

// 13. A failing removal is counted, not thrown.
{
  const r = await I.removeRemovableIssues(base.issues, async (p) => { if (p.endsWith("orphan9")) throw new Error("busy"); });
  check("failed removal is counted", r.removed === 1 && r.failed === 1, JSON.stringify(r));
}

// 14. Empty install: every expected chapter is missing; nothing is removable.
{
  const r = await run({});
  check("empty install: 6 missing, none removable", r.missingChapterFiles === 6 && !r.issues.some((i) => i.removable));
}

// 15. Unreadable index: no folder is treated as unlinked, so nothing is removable.
{
  const r = await run(BASE_FILES, NOVELS, null);
  check("unreadable index: orphan folder needs attention, not removable",
    r.unlinkedFolders === 0 && r.issues.some((i) => i.path === `${APP}/chapters/orphan9` && i.kind === "needsAttention" && i.removable === false));
  check("unreadable index: no removable issue at all", !r.issues.some((i) => i.removable && i.kind === "unlinkedFolder"));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
