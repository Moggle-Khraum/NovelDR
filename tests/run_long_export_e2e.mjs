import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
const L = await import("/home/claude/phase2/tools/build5/longExport.ts");

const ROOT = "/home/claude/phase4/e2e";
const N = 60;
const CHAPTERS = Array.from({ length: N }, (_, i) => ({
  index: i,
  title: i === 14 ? "Chapter V: The Storm" : i === 0 ? "Prologue" : `Chapter ${i + 1}`,
  content: `Paragraph one of chapter ${i + 1}, with & and <tags>.\n\nSecond line of ${i + 1}\nwith a break, “curly” — and emoji 📚 end ${i + 1}. {braces} and \\backslash`,
  bytes: 200_000,
}));
const sourceFile = (index) => path.join(ROOT, "source", `chapter_${index}.json`);
const P = await import("/home/claude/phase2/tools/build5/exportPlan.ts");
const PLAN = P.planExport(CHAPTERS.map((c) => ({ index: c.index, title: c.title, bytes: c.bytes })));
const RANGES = PLAN.parts.map((p) => [p.firstChapter, p.lastChapter]);

function makeAdapters(opts = {}) {
  const writes = [];
  const adapters = {
    freeBytes: async () => opts.free ?? 1024 * 1024 * 1024,
    readSource: async (index) => {
      if (opts.missing?.includes(index)) return null;
      const c = CHAPTERS[index];
      return c ? { title: c.title, content: c.content } : null;
    },
    stage: async (partNumber, position, title, content) => {
      const f = path.join(ROOT, "staging", `${position}.json`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ partNumber, title, content }));
    },
    readStaged: async (position) => {
      if (opts.failReadAt === position) throw new Error("staging read failed");
      const f = path.join(ROOT, "staging", `${position}.json`);
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      return { title: j.title, content: j.content };
    },
    writeText: async (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); writes.push(p); },
    writeBase64: async (p, b64) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, "base64")); writes.push(p); },
    moveFile: async (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); },
    deleteDir: async (p) => { fs.rmSync(p, { recursive: true, force: true }); },
    readBase64: async (p) => fs.readFileSync(p).toString("base64"),
    zipFinished: async (files, note, zipPath) => {
      const zip = new JSZip();
      for (const f of files) zip.file(path.basename(f), fs.readFileSync(f), { compression: "STORE" });
      zip.file("NOTE.txt", note);
      const b = await zip.generateAsync({ type: "nodebuffer" });
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      fs.writeFileSync(zipPath, b);
      return zipPath;
    },
  };
  return { adapters, writes };
}

function reset() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
}
const input = (format, extra = {}) => ({
  novelId: "1762600000-long", title: "Long Novel Test", author: "Test Author",
  format, chapters: CHAPTERS.map((c) => ({ index: c.index, title: c.title, bytes: c.bytes })),
  baseDir: path.join(ROOT, "out", format, "Long Novel Test/"),
  zipPath: path.join(ROOT, "out", format, "Long Novel Test.zip"),
  isCancelled: () => false,
  ...extra,
});

let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`); };

for (const format of ["epub", "docx", "txt", "rtf"]) {
  reset();
  // Seed the library's chapter source is handled by readSource; staging is written by the runner.
  const { adapters } = makeAdapters();
  const r = await L.runLongNovelExport(input(format), adapters);
  check(`${format}: export done`, r.phase === "done", JSON.stringify({ phase: r.phase, note: r.note }));
  check(`${format}: two parts finished`, r.completedParts.length === 2, `got ${r.completedParts.length}`);
  check(`${format}: zip created`, !!r.zipPath && fs.existsSync(r.zipPath));
  const zip = await JSZip.loadAsync(fs.readFileSync(r.zipPath));
  const names = Object.keys(zip.files).sort();
  check(`${format}: zip holds both parts and the note`, names.includes(`part-1${L.FORMAT_EXTENSION[format]}`) && names.includes(`part-2${L.FORMAT_EXTENSION[format]}`) && names.includes("NOTE.txt"), names.join(","));
  const note = await zip.file("NOTE.txt").async("string");
  check(`${format}: note says all complete`, /All 2 parts complete/.test(note), note);
  const leftover = fs.existsSync(path.join(ROOT, "out", format, "Long Novel Test/parts")) ? fs.readdirSync(path.join(ROOT, "out", format, "Long Novel Test/parts")) : [];
  check(`${format}: no part folders left behind`, leftover.length === 0, leftover.join(","));

  for (const n of [1, 2]) {
    const part = path.join(ROOT, "out", format, "Long Novel Test/", `part-${n}${L.FORMAT_EXTENSION[format]}`);
    const [first, last] = RANGES[n - 1];
    if (format === "txt") {
      const t = fs.readFileSync(part, "utf8");
      const ok = t.includes(`Long Novel Test (Part ${n} of ${RANGES.length})`) && t.includes(CHAPTERS[last - 1].title) && t.includes(`Paragraph one of chapter ${last}, with & and <tags>.`) && t.includes(`Chapters ${first} to ${last}`) && !t.includes(`Paragraph one of chapter ${last + 1},`);
      check(`txt part ${n}: header, range, last chapter text, order`, ok);
    } else if (format === "rtf") {
      const t = fs.readFileSync(part, "utf8");
      const ok = t.startsWith("{\\rtf1") && t.includes(`{\\b ${CHAPTERS[last - 1].title}}`) && (last >= N || !t.includes(`{\\b ${CHAPTERS[last].title}}`)) && t.includes("\\{braces\\}") && t.includes("\\\\backslash") && t.endsWith("}");
      check(`rtf part ${n}: valid header, range, escapes, closing brace`, ok);
    } else {
      const z = await JSZip.loadAsync(fs.readFileSync(part));
      const entries = Object.keys(z.files);
      const first_ = entries[0];
      if (format === "epub") {
        check(`epub part ${n}: mimetype first`, first_ === "mimetype");
        const chap = entries.filter((e) => /^OEBPS\/chapter-\d{4}\.xhtml$/.test(e)).sort();
        check(`epub part ${n}: only chapters ${first}..${last}`, chap.length === last - first + 1 && chap[0] === `OEBPS/chapter-${String(first).padStart(4, "0")}.xhtml` && chap[chap.length - 1] === `OEBPS/chapter-${String(last).padStart(4, "0")}.xhtml`);
      } else {
        const doc = await z.file("word/document.xml").async("string");
        const heads = (doc.match(/Heading1/g) || []).length;
        check(`docx part ${n}: chapter headings ${last - first + 1}`, heads === last - first + 1, `got ${heads}`);
      }
    }
  }
}

// Cancel mid-run: finished parts kept, unfinished part discarded, note says so.
{
  reset();
  let cancelled = false;
  const { adapters } = makeAdapters();
  const orig = adapters.readSource;
  adapters.readSource = async (i) => { if (i === 40) cancelled = true; return orig(i); };
  const r = await L.runLongNovelExport(input("txt", { isCancelled: () => cancelled }), adapters);
  check("cancel mid-run: phase cancelled", r.phase === "cancelled", r.phase);
  check("cancel mid-run: part 1 kept, part 2 discarded", r.completedParts.length === 1 && !fs.existsSync(path.join(ROOT, "out/txt/Long Novel Test/part-2.txt")));
  check("cancel mid-run: note names the stop", /Stopped at part 2 of 2/.test(r.note) && /Part 1 is complete/.test(r.note), r.note);
}

// Low space: refused before any output.
{
  reset();
  const { adapters, writes } = makeAdapters({ free: 10 * 1024 * 1024 });
  const r = await L.runLongNovelExport(input("epub"), adapters);
  check("low space: refused, nothing written", r.phase === "refused" && writes.length === 0);
}

// Missing chapter: placeholder, counted, export still completes.
{
  reset();
  const { adapters } = makeAdapters({ missing: [9] });
  const r = await L.runLongNovelExport(input("txt"), adapters);
  check("missing chapter: counted and export completes", r.missingChapters === 1 && r.phase === "done", JSON.stringify({ m: r.missingChapters, p: r.phase }));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
