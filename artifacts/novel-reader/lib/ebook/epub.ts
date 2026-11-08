// EPUB 3 package builder.
//
// Returns the complete file set of an EPUB as { path: text }. Packaging into a
// ZIP is done separately (see package.ts). Entries are returned in the order
// they must appear in the archive: "mimetype" first.

import { isoSeconds, safeId, splitParagraphs, xmlText } from "./xml";

export type EbookChapter = { title: string; content: string };

export type EpubMeta = {
  // Stable internal id of the novel. Used to build the book identifier.
  id: string;
  title: string;
  author: string;
  language?: string;
  modified?: Date;
};

const XML_DECL = `<?xml version="1.0" encoding="UTF-8"?>`;

const STYLE_CSS = `body {
  font-family: serif;
  line-height: 1.5;
  margin: 1em;
}
h1 {
  font-size: 1.6em;
  margin: 1.5em 0 0.8em 0;
  page-break-before: always;
}
h1.title-page-heading {
  page-break-before: avoid;
  text-align: center;
}
p {
  margin: 0 0 0.6em 0;
  text-indent: 1.2em;
}
p.first, h1 + p {
  text-indent: 0;
}
.subtitle {
  text-align: center;
  font-style: italic;
}
`;

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(4, "0")}.xhtml`;
}

function xhtmlPage(
  language: string,
  title: string,
  bodyHtml: string,
): string {
  return `${XML_DECL}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlText(language)}" lang="${xmlText(language)}">
<head>
  <meta charset="UTF-8"/>
  <title>${xmlText(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

function paragraphsToHtml(text: string): string {
  return splitParagraphs(text)
    .map((lines) => {
      const inner = lines.map((line) => xmlText(line)).join("<br/>");
      return `<p>${inner}</p>`;
    })
    .join("\n");
}

export function buildEpubFiles(
  meta: EpubMeta,
  chapters: EbookChapter[],
): Record<string, string> {
  const language = meta.language ?? "en";
  const bookId = `urn:noveldr:${safeId(meta.id)}`;
  const modified = isoSeconds(meta.modified);
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";

  const files: Record<string, string> = {};

  // 1. mimetype: must be the first entry, stored without compression.
  files["mimetype"] = "application/epub+zip";

  // 2. Container: points to the package document.
  files["META-INF/container.xml"] = `${XML_DECL}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  // 3. Title page.
  files["OEBPS/title.xhtml"] = xhtmlPage(
    language,
    displayTitle,
    `<h1 class="title-page-heading">${xmlText(displayTitle)}</h1>
<p class="subtitle">by ${xmlText(displayAuthor)}</p>`,
  );

  // 4. One XHTML file per chapter.
  const chapterItems: { id: string; href: string; title: string }[] = [];
  chapters.forEach((chapter, index) => {
    const href = chapterFileName(index);
    const heading = chapter.title.trim() || `Chapter ${index + 1}`;
    files[`OEBPS/${href}`] = xhtmlPage(
      language,
      heading,
      `<h1>${xmlText(heading)}</h1>\n${paragraphsToHtml(chapter.content)}`,
    );
    chapterItems.push({ id: `chapter-${index + 1}`, href, title: heading });
  });

  // 5. Stylesheet.
  files["OEBPS/style.css"] = STYLE_CSS;

  // 6. Navigation document (EPUB 3 required).
  const navItems = [
    `<li><a href="title.xhtml">${xmlText(displayTitle)}</a></li>`,
    ...chapterItems.map(
      (item) => `<li><a href="${item.href}">${xmlText(item.title)}</a></li>`,
    ),
  ].join("\n      ");
  files["OEBPS/nav.xhtml"] = `${XML_DECL}
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
`;

  // 7. NCX table of contents, for older readers that do not read the nav document.
  const ncxPoints = [
    { id: "np-title", href: "title.xhtml", title: displayTitle },
    ...chapterItems.map((item) => ({ id: `np-${item.id}`, href: item.href, title: item.title })),
  ]
    .map(
      (point, index) => `    <navPoint id="${point.id}" playOrder="${index + 1}">
      <navLabel><text>${xmlText(point.title)}</text></navLabel>
      <content src="${point.href}"/>
    </navPoint>`,
    )
    .join("\n");
  files["OEBPS/toc.ncx"] = `${XML_DECL}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlText(bookId)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlText(displayTitle)}</text></docTitle>
  <navMap>
${ncxPoints}
  </navMap>
</ncx>
`;

  // 8. Package document (OPF): metadata, manifest, reading order.
  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    `    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapterItems.map(
      (item) =>
        `    <item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");
  const spine = [
    `    <itemref idref="title"/>`,
    ...chapterItems.map((item) => `    <itemref idref="${item.id}"/>`),
  ].join("\n");

  files["OEBPS/content.opf"] = `${XML_DECL}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${xmlText(bookId)}</dc:identifier>
    <dc:title>${xmlText(displayTitle)}</dc:title>
    <dc:creator>${xmlText(displayAuthor)}</dc:creator>
    <dc:language>${xmlText(language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;

  return files;
}
