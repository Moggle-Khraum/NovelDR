// Phase 3e tests: refill missing chapters by retrying fetch, against the real lib/chapterRefill.ts.
import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib/chapterRefill.ts";
const BUILD = "/home/claude/phase3e/build";
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, "chapterRefill.ts"), fs.readFileSync(SRC, "utf8").replace(/from "\.\/libraryIntegrity"/g, 'from "./libraryIntegrity.ts"').replace(/from "\.\/chapterOrder"/g, 'from "./chapterOrder.ts"'));
fs.writeFileSync(path.join(BUILD, "libraryIntegrity.ts"), "export {};\n");
fs.copyFileSync("/home/claude/noveldr-audit/artifacts/novel-reader/lib/chapterOrder.ts", path.join(BUILD, "chapterOrder.ts"));
const R = await import(path.join(BUILD, "chapterRefill.ts"));

const NOVELS = [
  {
    id: "n1", title: "Alpha",
    chapters: [
      { title: "Chapter 1", url: "/a/c1", chapterNumber: 1 },
      { title: "Chapter 2", url: "/a/c2" },
      { title: "Chapter 3", url: "/a/c3" },
    ],
  },
  {
    id: "n3", title: "Gamma",
    chapters: [
      { title: "Chapter 1", url: "/g/c1" },
      { title: "Chapter 2", url: "" },
    ],
  },
];
const missing = (novelId, chapterIndex) => ({ kind: "missingChapterFile", reason: "", removable: false, novelId, chapterIndex });
const ISSUES = [
  missing("n1", 1),
  missing("n3", 0),
  missing("n3", 1),
  { kind: "leftoverFile", reason: "", removable: true, novelId: "n1", path: "/x" },
];

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`);
};

// Fake deps: fetch returns content from a table; save records calls.
function deps(overrides = {}) {
  const saved = [];
  const fetched = [];
  let inFlight = 0, maxInFlight = 0;
  const progress = [];
  return {
    saved, fetched, progress,
    get maxInFlight() { return maxInFlight; },
    fetch: async (url, n) => {
      fetched.push({ url, n });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      if (overrides.fetch) return overrides.fetch(url, n);
      return { title: `Fetched ${url}`, content: `Text of ${url}` };
    },
    save: async (target, title, content) => {
      if (overrides.save) return overrides.save(target, title, content);
      saved.push({ novelId: target.novelId, index: target.index, url: target.url, title, content });
    },
    onProgress: (done, total) => progress.push([done, total]),
    shouldStop: overrides.shouldStop,
  };
}

// 1. Targets come only from missing-chapter issues, with stored URL and title.
{
  const t = R.buildRefillTargets(ISSUES, NOVELS);
  check("one target per missing chapter (leftovers ignored)", t.length === 3, `got ${t.length}`);
  const n1 = t.find((x) => x.novelId === "n1");
  check("target carries the stored URL, title, and index", n1.url === "/a/c2" && n1.title === "Chapter 2" && n1.index === 1, JSON.stringify(n1));
  const n3b = t.find((x) => x.novelId === "n3" && x.index === 1);
  check("a chapter with no stored URL is kept as a target with an empty URL", n3b.url === "", JSON.stringify(n3b));
  check("unknown novel id is skipped", R.buildRefillTargets([missing("ghost", 0)], NOVELS).length === 0);
}

// 2. Success path: every missing chapter fetched by its URL and saved at its index.
{
  const d = deps();
  const targets = R.buildRefillTargets(ISSUES, NOVELS);
  const r = await R.refillChapters(targets.filter((t) => t.url), d);
  check("two fetchable chapters refilled", r.filled === 2 && r.failed.length === 0, JSON.stringify(r));
  check("fetched by the stored URLs", d.fetched.map((f) => f.url).join(",") === "/a/c2,/g/c1", d.fetched.map((f) => f.url).join(","));
  check("saved at the same index it was missing from", d.saved.some((s) => s.novelId === "n1" && s.index === 1));
  check("saved content is the fetched text", d.saved[0].content === "Text of /a/c2");
  check("fetched title is used when present", d.saved[0].title === "Fetched /a/c2");
}

// 3. A failing fetch does not stop the run; the reason is recorded.
{
  const d = deps({ fetch: async (url) => { if (url === "/a/c2") throw new Error("Hard timeout after 15000ms"); return { title: "T", content: "ok" }; } });
  const r = await R.refillChapters(R.buildRefillTargets(ISSUES, NOVELS).filter((t) => t.url), d);
  check("failed fetch recorded with its reason", r.failed.length === 1 && r.failed[0].reason.includes("Hard timeout"), JSON.stringify(r.failed));
  check("the other chapter is still saved", r.filled === 1 && d.saved.length === 1 && d.saved[0].url === "/g/c1");
}

// 4. Empty content is a failure and is never saved.
{
  const d = deps({ fetch: async () => ({ title: "T", content: "   " }) });
  const r = await R.refillChapters(R.buildRefillTargets(ISSUES, NOVELS).filter((t) => t.url), d);
  check("empty content: failed with a clear reason, nothing saved", r.filled === 0 && d.saved.length === 0 && r.failed[0].reason.includes("no text"));
}

// 5. A chapter with no stored URL is reported and never fetched.
{
  const d = deps();
  const r = await R.refillChapters(R.buildRefillTargets(ISSUES, NOVELS), d);
  const noUrl = r.failed.find((f) => f.index === 1 && f.novelTitle === "Gamma");
  check("no stored URL: reported, not fetched", !!noUrl && noUrl.reason.includes("No saved address") && !d.fetched.some((f) => f.url === ""));
}

// 6. Stop request ends the run after the current chapter.
{
  let calls = 0;
  const d = deps({ shouldStop: () => calls >= 1 });
  const original = d.fetch;
  d.fetch = async (u, n) => { calls++; return original(u, n); };
  const targets = R.buildRefillTargets(ISSUES, NOVELS).filter((t) => t.url);
  const r = await R.refillChapters(targets, d);
  check("stop request: run ends early and reports stopped", r.stopped === true && r.filled === 1, JSON.stringify(r));
}

// 7. A save failure is recorded, not counted as filled.
{
  const d = deps({ save: async () => { throw new Error("disk full"); } });
  const r = await R.refillChapters(R.buildRefillTargets(ISSUES, NOVELS).filter((t) => t.url), d);
  check("save failure: recorded and not counted", r.filled === 0 && r.failed.length === 2 && r.failed[0].reason === "disk full");
}

// 8. Only missing chapters are ever written.
{
  const d = deps();
  const targets = R.buildRefillTargets(ISSUES, NOVELS);
  await R.refillChapters(targets.filter((t) => t.url), d);
  const allowed = new Set(targets.map((t) => `${t.novelId}:${t.index}`));
  check("writes only the missing chapters", d.saved.every((s) => allowed.has(`${s.novelId}:${s.index}`)));
  check("never writes chapter 0 of n1 (present on disk)", !d.saved.some((s) => s.novelId === "n1" && s.index === 0));
}

// 9. Fetches run one at a time.
{
  const d = deps();
  const many = Array.from({ length: 5 }, (_, i) => ({ novelId: "n1", novelTitle: "Alpha", index: i, url: `/x/${i}`, title: `C${i}`, chapterNumber: i + 1 }));
  await R.refillChapters(many, d);
  check("fetches are sequential (never more than one in flight)", d.maxInFlight === 1, `max in flight ${d.maxInFlight}`);
}

// 10. Progress reports the final count.
{
  const d = deps();
  await R.refillChapters(R.buildRefillTargets(ISSUES, NOVELS).filter((t) => t.url), d);
  const last = d.progress[d.progress.length - 1];
  check("progress ends at (total, total)", last && last[0] === 2 && last[1] === 2, JSON.stringify(d.progress));
}

// 11. Nothing to refill.
{
  const r = await R.refillChapters([], deps());
  check("no targets: nothing filled, nothing failed", r.filled === 0 && r.failed.length === 0 && r.stopped === false);
}

// 12. Chapter number comes from the stored value, then the title, then the position.
{
  const t = R.buildRefillTargets(
    [missing("p", 0), missing("p", 1), missing("p", 2)],
    [{ id: "p", title: "P", chapters: [
      { title: "Chapter V", url: "/p/v", },
      { title: "Prologue", url: "/p/pro" },
      { title: "Chapter 9", url: "/p/9", chapterNumber: 42 },
    ] }],
  );
  check("chapter number from a Roman-numeral title", t[0].chapterNumber === 5, JSON.stringify(t[0]));
  check("unnumbered chapter falls back to its position", t[1].chapterNumber === 2, JSON.stringify(t[1]));
  check("stored chapter number wins over the title", t[2].chapterNumber === 42, JSON.stringify(t[2]));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
