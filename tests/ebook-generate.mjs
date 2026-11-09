// Generates sample EPUB and DOCX files from the REAL lib/ebook modules.
import fs from "node:fs";
import path from "node:path";
const SRC = "/home/claude/noveldr-audit/artifacts/novel-reader/lib/ebook";
const BUILD = "/home/claude/phase2/tools/build";
fs.mkdirSync(BUILD, { recursive: true });
for (const f of ["xml.ts", "epub.ts", "docx.ts", "package.ts"]) {
  let s = fs.readFileSync(path.join(SRC, f), "utf8");
  s = s.replace(/from "\.\/(xml|epub|docx|package)"/g, 'from "./$1.ts"');
  fs.writeFileSync(path.join(BUILD, f), s);
}
const epub = await import(path.join(BUILD, "epub.ts"));
const docx = await import(path.join(BUILD, "docx.ts"));
const pkg = await import(path.join(BUILD, "package.ts"));

const meta = { id: "1762600000-abc", title: 'Tom & Jerry\'s "Tale" <Vol. 1>', author: "Café Ñ — 日本 Author" };
const chapters = [
  { title: "Prologue", content: "The rain had not stopped for nine days.\n\nNobody in Harrow remembered a drier autumn." },
  { title: "Chapter 1", content: "Line one of a paragraph\nline two of the same paragraph.\n\nA new paragraph with an ampersand: this & that, and <tags> that must be escaped." },
  { title: "Chapter V", content: "Short.\u0001 A short chapter with a control character removed." },
  { title: "Extra: The Cat's Interlude", content: "\u2014 Unicode dash, curly quotes \u201cok\u201d, emoji \ud83d\udcda end." },
];
const epubFiles = epub.buildEpubFiles(meta, chapters);
const docxFiles = docx.buildDocxFiles(meta, chapters);

const epubB64 = await pkg.zipToBase64(epubFiles, "application/epub+zip");
const docxB64 = await pkg.zipToBase64(docxFiles, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
fs.writeFileSync("/home/claude/phase2/out/sample.epub", Buffer.from(epubB64, "base64"));
fs.writeFileSync("/home/claude/phase2/out/sample.docx", Buffer.from(docxB64, "base64"));
console.log("EPUB parts:", Object.keys(epubFiles).join(", "));
console.log("DOCX parts:", Object.keys(docxFiles).join(", "));
console.log("written:", fs.statSync("/home/claude/phase2/out/sample.epub").size, "bytes epub,", fs.statSync("/home/claude/phase2/out/sample.docx").size, "bytes docx");
