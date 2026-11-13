import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib";
const BUILD = "/home/claude/phase5/build";
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, "pdfExport.ts"), fs.readFileSync(path.join(SRC, "pdfExport.ts"), "utf8").replace(/from "\.\/exportRunner"/g, 'from "./exportRunner.ts"'));
fs.writeFileSync(path.join(BUILD, "exportRunner.ts"), fs.readFileSync(path.join(SRC, "exportRunner.ts"), "utf8").replace(/from "\.\/exportPlan"/g, 'from "./exportPlan.ts"'));
fs.copyFileSync(path.join(SRC, "exportPlan.ts"), path.join(BUILD, "exportPlan.ts"));
const M = await import(path.join(BUILD, "pdfExport.ts"));

let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n      " + detail : ""}`); };
const MB = 1048576;
const CH = Array.from({ length: 60 }, (_, i) => ({ index: i, title: `Chapter ${i + 1}`, content: `Para ${i + 1} & <b>x</b> "q"\nline two` }));
const SRCS = CH.map((c) => ({ index: c.index, title: c.title }));

function deps(o = {}) {
  const log = { reads: [], yields: 0, printed: [], moves: [] };
  return {
    log,
    readChapter: async (i) => { log.reads.push(i); if (o.missing?.includes(i)) return null; return { title: CH[i].title, content: CH[i].content }; },
    yieldToUi: async () => { log.yields++; },
    isCancelled: o.isCancelled ?? (() => false),
    maxChars: o.maxChars,
    freeBytes: async () => o.free ?? 1024 * MB,
    printToFile: async (html) => { log.printed.push(html); if (o.failPrint) throw new Error("print engine crashed"); return "/tmp/print.pdf"; },
    moveFile: async (from, to) => { log.moves.push([from, to]); },
    onEvent: () => {},
  };
}

// 1. Full build: fragments in order, joined once, all chapters present.
{
  const d = deps();
  const r = await M.buildPdfHtml({ title: "Long Novel", author: "Ann", chapters: SRCS }, d);
  check("build ok", r.status === "ok");
  const pos = CH.map((c) => r.html.indexOf(`<div class="chapter-title">${c.title}</div>`));
  check("all 60 chapter titles present", pos.every((p) => p >= 0));
  check("chapter titles in reading order", pos.every((p, i) => i === 0 || p > pos[i - 1]));
  check("reads each chapter exactly once, in order", d.log.reads.join(",") === Array.from({ length: 60 }, (_, i) => i).join(","));
  check("footer closes the document", r.html.trimEnd().endsWith("</html>") && r.html.includes("End of Long Novel"));
}

// 2. Escaping: user text cannot inject markup.
{
  const r = await M.buildPdfHtml({ title: "<img src=x>", author: "A&B", chapters: [{ index: 0, title: "<script>t</script>" }] }, { ...deps(), readChapter: async () => ({ title: "<script>t</script>", content: "<script>alert(1)</script> & done" }) });
  check("content and titles are escaped", !r.html.includes("<script>") && r.html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; done"));
  check("title page escaped", r.html.includes("&lt;img src=x&gt;") && r.html.includes("A&amp;B"));
}

// 3. Lean markup: no inline styles in the chapter body; one stylesheet.
{
  const r = await M.buildPdfHtml({ title: "N", author: "A", chapters: SRCS }, deps());
  const body = r.html.slice(r.html.indexOf("<body>"));
  check("no inline style attributes in the body", !body.includes("style="));
  check("exactly one stylesheet", r.html.split("<style>").length === 2);
  check("no web font imports", !r.html.includes("@import") && !r.html.includes("fonts.googleapis"));
}

// 4. Yield to the UI after each chapter.
{
  const d = deps();
  await M.buildPdfHtml({ title: "N", author: "A", chapters: SRCS }, d);
  check("yields once per chapter", d.log.yields === 60, `got ${d.log.yields}`);
}

// 5. Cancel stops the build; nothing is printed.
{
  let stop = false;
  const d = deps({ isCancelled: () => stop });
  const orig = d.readChapter;
  d.readChapter = async (i) => { if (i === 10) stop = true; return orig(i); };
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("cancel: phase cancelled, nothing printed", r.phase === "cancelled" && d.log.printed.length === 0);
  check("cancel: stopped early", d.log.reads.length < 60, `read ${d.log.reads.length}`);
}

// 6. Size limit: refused while building, before reading everything.
{
  const d = deps({ maxChars: 5000 });
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("size limit: refused", r.phase === "refused" && /too large/.test(r.note), r.note);
  check("size limit: nothing printed", d.log.printed.length === 0);
  check("size limit: stopped before reading all chapters", d.log.reads.length < 60, `read ${d.log.reads.length}`);
}

// 7. Print failure: reported, no file moved, note suggests other formats.
{
  const d = deps({ failPrint: true });
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("print failure: phase failed, no move", r.phase === "failed" && d.log.moves.length === 0);
  check("print failure: note names the reason and the alternatives", /print engine crashed/.test(r.note) && /EPUB, DOCX, TXT, or RTF/.test(r.note), r.note);
}

// 8. Success: printed once, moved to the final path.
{
  const d = deps();
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("success: done with final path", r.phase === "done" && r.pdfPath === "/out/N.pdf");
  check("success: printed once and moved", d.log.printed.length === 1 && d.log.moves[0][1] === "/out/N.pdf");
}

// 9. Missing chapter: placeholder, counted, export completes.
{
  const d = deps({ missing: [7] });
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("missing: counted and completes", r.missing === 1 && r.phase === "done");
  check("missing: placeholder present in the printed HTML", d.log.printed[0].includes("has no saved content"));
}

// 10. Low space: refused before reading anything.
{
  const d = deps({ free: 50 * MB });
  const r = await M.exportLongPdf({ title: "N", author: "A", chapters: SRCS, finalPath: "/out/N.pdf" }, d);
  check("low space: refused, nothing read", r.phase === "refused" && d.log.reads.length === 0);
}

// 11. Default limit is set and sensible.
check("default size limit is 20 million characters", M.PDF_MAX_HTML_CHARS === 20_000_000);

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
