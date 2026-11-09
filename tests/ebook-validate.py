import zipfile, xml.dom.minidom, sys, re, subprocess, os
from pathlib import Path
fails = []
def ok(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond or not detail else "\n      " + detail))
    if not cond: fails.append(name)

OUT = Path("/home/claude/phase2/out")
# ---------- EPUB ----------
epub = zipfile.ZipFile(OUT/"sample.epub")
names = epub.namelist()
ok("EPUB: mimetype is the first archive entry", names[0] == "mimetype", str(names[:2]))
info = epub.getinfo("mimetype")
ok("EPUB: mimetype stored uncompressed", info.compress_type == zipfile.ZIP_STORED, str(info.compress_type))
ok("EPUB: mimetype content exact (no newline)", epub.read("mimetype") == b"application/epub+zip", repr(epub.read("mimetype")))
ok("EPUB: no directory entries", not any(n.endswith("/") for n in names), str([n for n in names if n.endswith("/")]))
ok("EPUB: container points at OPF", b'full-path="OEBPS/content.opf"' in epub.read("META-INF/container.xml"))
bad_xml = []
for n in names:
    if n.endswith((".xml", ".xhtml", ".opf", ".ncx", ".css")) and not n.endswith(".css"):
        try: xml.dom.minidom.parseString(epub.read(n))
        except Exception as e: bad_xml.append(f"{n}: {e}")
ok("EPUB: every XML part is well-formed", not bad_xml, "; ".join(bad_xml))

# Manifest covers every content file; every spine idref exists.
opf = xml.dom.minidom.parseString(epub.read("OEBPS/content.opf"))
manifest_hrefs = {i.getAttribute("href") for i in opf.getElementsByTagName("item")}
ids = {i.getAttribute("id") for i in opf.getElementsByTagName("item")}
spine_refs = [r.getAttribute("idref") for r in opf.getElementsByTagName("itemref")]
ok("EPUB: every spine idref is in the manifest", all(r in ids for r in spine_refs), str(spine_refs))
present = {n[len("OEBPS/"):] for n in names if n.startswith("OEBPS/")}
missing = [h for h in manifest_hrefs if h not in present]
unlisted = [p for p in present if p not in manifest_hrefs and p != "content.opf"]
ok("EPUB: every manifest href exists in the archive", not missing, str(missing))
ok("EPUB: every content file is listed in the manifest", not unlisted, str(unlisted))

# Round-trip: chapter text recovered from XHTML equals input (control char removed).
def xhtml_paragraphs(data):
    doc = xml.dom.minidom.parseString(data)
    return [ "".join(t.nodeValue or "" for t in p.childNodes if t.nodeType==t.TEXT_NODE) for p in doc.getElementsByTagName("p") ]
ch2 = xhtml_paragraphs(epub.read("OEBPS/chapter-0003.xhtml"))  # Chapter V
ok("EPUB: control character stripped from text", not any("\x01" in p for p in ch2))
ok("EPUB: short chapter (Chapter V) kept", any("A short chapter" in p for p in ch2), str(ch2))
ch4 = xhtml_paragraphs(epub.read("OEBPS/chapter-0004.xhtml"))
ok("EPUB: unicode/curly quotes/emoji survive", any("\u201cok\u201d" in p and "\U0001F4DA" in p for p in ch4), str(ch4))
ch2h = xml.dom.minidom.parseString(epub.read("OEBPS/chapter-0002.xhtml")).getElementsByTagName("p")
ok("EPUB: line break inside paragraph kept as <br/>", "<br" in epub.read("OEBPS/chapter-0002.xhtml").decode())
title_text = epub.read("OEBPS/title.xhtml").decode()
ok("EPUB: special chars escaped in title page", "Tom &amp; Jerry" in title_text and "&lt;Vol. 1&gt;" in title_text)

# ---------- DOCX ----------
docx_zip = zipfile.ZipFile(OUT/"sample.docx")
dn = docx_zip.namelist()
bad = []
for n in dn:
    try: xml.dom.minidom.parseString(docx_zip.read(n))
    except Exception as e: bad.append(f"{n}: {e}")
ok("DOCX: every part is well-formed XML", not bad, "; ".join(bad))
ct = docx_zip.read("[Content_Types].xml").decode()
ok("DOCX: every part has a content type", all(("/"+n) in ct or n.endswith(".rels") or n.endswith(".xml") for n in dn if n != "[Content_Types].xml"))
for part in ["/word/document.xml", "/word/styles.xml", "/docProps/core.xml"]:
    ok(f"DOCX: Override for {part}", f'PartName="{part}"' in ct)

import docx as pydocx
d = pydocx.Document(OUT/"sample.docx")
paras = [(p.style.name, p.text) for p in d.paragraphs]
ok("DOCX (python-docx): opens", True)
ok("DOCX: Title paragraph uses Title style", paras[0][0] == "Title", str(paras[0]))
ok("DOCX: chapter headings use Heading 1 style", sum(1 for s,_ in paras if s == "Heading 1") == 4, str([p for p in paras if p[0]=="Heading 1"]))
body_texts = [t for _,t in paras]
ok("DOCX: chapter body text present", any("nine days" in t for t in body_texts))
ok("DOCX: title special characters exact", paras[0][1] == 'Tom & Jerry\'s "Tale" <Vol. 1>', repr(paras[0][1]))
ok("DOCX: author line exact", paras[1][1] == "by Café Ñ — 日本 Author", repr(paras[1][1]))
ok("DOCX: core properties title/author", d.core_properties.title.startswith("Tom & Jerry") and "Café" in d.core_properties.author, f"{d.core_properties.title!r} / {d.core_properties.author!r}")
ok("DOCX: line-break paragraph keeps both lines", any("Line one of a paragraph" in t and "line two" in t for t in body_texts))
ok("DOCX: no control characters in text", not any("\x01" in t for t in body_texts))
ok("DOCX: page setup is US Letter", d.sections[0].page_width.inches == 8.5 and d.sections[0].page_height.inches == 11.0)

# Independent parser 2: pandoc
pd = subprocess.run(["pandoc", str(OUT/"sample.docx"), "-t", "plain"], capture_output=True, text=True)
ok("DOCX (pandoc): parses without error", pd.returncode == 0, pd.stderr[:300])
ok("DOCX (pandoc): chapter text recovered", "nine days" in pd.stdout and "Chapter V" in pd.stdout, pd.stdout[:200])

# Independent parser 3: LibreOffice render to PDF
lo = subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(OUT), str(OUT/"sample.docx")], capture_output=True, text=True, timeout=240)
pdf = OUT/"sample.pdf"
ok("DOCX (LibreOffice): opens and renders to PDF", lo.returncode == 0 and pdf.exists(), (lo.stdout+lo.stderr)[:300])
if pdf.exists():
    pages = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", pages)
    ok("DOCX (LibreOffice): 5 pages (title + 4 chapters, each on its own page)", m and int(m.group(1)) == 5, pages[:200])

SRC = [
  ("Prologue", ["The rain had not stopped for nine days.", "Nobody in Harrow remembered a drier autumn."]),
  ("Chapter 1", ["Line one of a paragraph\nline two of the same paragraph.", "A new paragraph with an ampersand: this & that, and <tags> that must be escaped."]),
  ("Chapter V", ["Short. A short chapter with a control character removed."]),
  ("Extra: The Cat's Interlude", ["\u2014 Unicode dash, curly quotes \u201cok\u201d, emoji \U0001F4DA end."]),
]
def norm(p): return [line.strip() for line in p.split("\n")]
# EPUB: each chapter file's <p> elements, with <br/> rejoined as newlines, equal the source
for i,(t,paras_src) in enumerate(SRC):
    fn = "OEBPS/title.xhtml" if i < 0 else f"OEBPS/chapter-{i+1:04d}.xhtml"
    if i == 0: fn = "OEBPS/chapter-0001.xhtml"
    doc = xml.dom.minidom.parseString(epub.read(fn))
    got=[]
    for p in doc.getElementsByTagName("p"):
        parts=[]
        for node in p.childNodes:
            if node.nodeType==node.TEXT_NODE: parts.append(node.nodeValue)
            elif node.nodeName=="br": parts.append("\n")
        got.append("".join(parts))
    expected=[ "\n".join(l.strip() for l in ps.split("\n")) for ps in paras_src ]
    ok(f"EPUB exact text: {t}", got == expected, f"got={got!r}\nexp={expected!r}")
# DOCX: body paragraphs after each Heading 1, exact text (line breaks as \n)
doc_paras = [(p.style.name, p.text) for p in d.paragraphs]
cur=None; groups={}
for style,text in doc_paras[2:]:
    if style=="Heading 1": cur=text; groups[cur]=[]
    else: groups[cur].append(text)
for t,paras_src in SRC:
    expected=[ "\n".join(l.strip() for l in ps.split("\n")) for ps in paras_src ]
    ok(f"DOCX exact text: {t}", groups.get(t)==expected, f"got={groups.get(t)!r}\nexp={expected!r}")

print("\nFAILURES:", len(fails))
sys.exit(1 if fails else 0)
