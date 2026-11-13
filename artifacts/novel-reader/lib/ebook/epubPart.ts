// Writes one EPUB part, one chapter at a time.
//
// A part is a complete, valid EPUB that holds a range of chapters. Chapters are
// read from staging one by one, rendered, and written straight to the part
// folder, so the part never sits in memory as a whole. The table of contents
// and package file are written last, from the titles collected along the way.
//
// Chapter file names use each chapter's position in the whole novel, so names
// stay stable across parts.

import {
  chapterFileName,
  paragraphsToHtml,
  STYLE_CSS,
  XML_DECL,
  xhtmlPage,
} from "./epub";
import { isoSeconds, safeId, xmlText } from "./xml";
import { coverPageXhtml, type EpubCover } from "./epubCover";

export type EpubPartMeta = {
  // Stable id of the novel.
  id: string;
  title: string;
  author: string;
  language?: string;
  modified?: Date;
};

export type EpubPartInfo = {
  number: number;
  total: number;
  // Chapter positions in the whole novel, 1-based, inclusive.
  firstChapter: number;
  lastChapter: number;
};

export type PartIo = {
  // Reads one staged chapter by its position in the novel.
  readStaged: (position: number) => Promise<{ title: string; content: string }>;
  // Writes one file of the part. Paths are relative to the part folder.
  writeText: (path: string, text: string) => Promise<void>;
};

type WrittenChapter = { id: string; href: string; title: string };

// Writes the part's files and returns their relative paths in zip order.
export async function writeEpubPart(
  meta: EpubPartMeta,
  part: EpubPartInfo,
  io: PartIo,
  cover?: EpubCover,
): Promise<string[]> {
  const language = meta.language ?? "en";
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";
  const partTitle = `${displayTitle} (Part ${part.number} of ${part.total})`;
  const bookId = `urn:noveldr:${safeId(meta.id)}-part-${part.number}`;
  const modified = isoSeconds(meta.modified);
  const written: string[] = [];

  const write = async (path: string, text: string) => {
    await io.writeText(path, text);
    written.push(path);
  };

  // 1. mimetype first: the packaging step must store it uncompressed.
  await write("mimetype", "application/epub+zip");

  // 2. Container.
  await write(
    "META-INF/container.xml",
    `${XML_DECL}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );

  // 2b. Cover page, when this part includes the novel cover.
  if (cover) {
    await write(
      "OEBPS/cover.xhtml",
      coverPageXhtml(language, partTitle, cover.fileName),
    );
  }

  // 3. Part title page.
  await write(
    "OEBPS/title.xhtml",
    xhtmlPage(
      language,
      partTitle,
      `<h1 class="title-page-heading">${xmlText(partTitle)}</h1>
<p class="subtitle">by ${xmlText(displayAuthor)}</p>
<p class="subtitle">Chapters ${part.firstChapter} to ${part.lastChapter}</p>`,
    ),
  );

  // 4. Chapters, one at a time.
  const chapters: WrittenChapter[] = [];
  for (
    let position = part.firstChapter;
    position <= part.lastChapter;
    position++
  ) {
    const staged = await io.readStaged(position);
    const heading = staged.title.trim() || `Chapter ${position}`;
    const href = chapterFileName(position - 1);
    await write(
      `OEBPS/${href}`,
      xhtmlPage(
        language,
        heading,
        `<h1>${xmlText(heading)}</h1>\n${paragraphsToHtml(staged.content)}`,
      ),
    );
    chapters.push({ id: `chapter-${position}`, href, title: heading });
  }

  // 5. Stylesheet.
  await write("OEBPS/style.css", STYLE_CSS);

  // 6. Navigation document.
  const navItems = [
    ...(cover ? [`<li><a href="cover.xhtml">Cover</a></li>`] : []),
    `<li><a href="title.xhtml">${xmlText(partTitle)}</a></li>`,
    ...chapters.map(
      (c) => `<li><a href="${c.href}">${xmlText(c.title)}</a></li>`,
    ),
  ].join("\n      ");
  await write(
    "OEBPS/nav.xhtml",
    `${XML_DECL}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="UTF-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${navItems}
    </ol>
  </nav>
</body>
</html>
`,
  );

  // 7. NCX table of contents, for older readers.
  const ncxPoints = [
    ...(cover ? [{ id: "np-cover", href: "cover.xhtml", title: "Cover" }] : []),
    { id: "np-title", href: "title.xhtml", title: partTitle },
    ...chapters.map((c) => ({
      id: `np-${c.id}`,
      href: c.href,
      title: c.title,
    })),
  ]
    .map(
      (p, index) => `    <navPoint id="${p.id}" playOrder="${index + 1}">
      <navLabel><text>${xmlText(p.title)}</text></navLabel>
      <content src="${p.href}"/>
    </navPoint>`,
    )
    .join("\n");
  await write(
    "OEBPS/toc.ncx",
    `${XML_DECL}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlText(bookId)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlText(partTitle)}</text></docTitle>
  <navMap>
${ncxPoints}
  </navMap>
</ncx>
`,
  );

  // 8. Package document.
  const manifest = [
    ...(cover
      ? [
          `    <item id="cover-image" href="${cover.fileName}" media-type="${cover.mediaType}" properties="cover-image"/>`,
          `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    `    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map(
      (c) =>
        `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");
  const spine = [
    ...(cover ? [`    <itemref idref="cover"/>`] : []),
    `    <itemref idref="title"/>`,
    ...chapters.map((c) => `    <itemref idref="${c.id}"/>`),
  ].join("\n");
  await write(
    "OEBPS/content.opf",
    `${XML_DECL}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${xmlText(bookId)}</dc:identifier>
    <dc:title>${xmlText(partTitle)}</dc:title>
    <dc:creator>${xmlText(displayAuthor)}</dc:creator>
    <dc:language>${xmlText(language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
${cover ? `    <meta name="cover" content="cover-image"/>\n` : ""}  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`,
  );

  return written;
}
