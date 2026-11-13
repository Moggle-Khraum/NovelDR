// Writes one DOCX part, one chapter at a time.
//
// The part's document body is appended to word/document.xml chapter by chapter,
// so the whole part never sits in memory. The package parts (content types,
// relationships, styles, core properties) are fixed and reuse the helpers in
// docx.ts, so a part is laid out the same way as a standard DOCX export.

import {
  coreXml,
  CONTENT_TYPES,
  DOCUMENT_RELS,
  paragraph,
  R_NS,
  ROOT_RELS,
  STYLES,
  W_NS,
  XML_DECL,
} from "./docx";
import { splitParagraphs } from "./xml";

export type DocxPartMeta = {
  id: string;
  title: string;
  author: string;
  modified?: Date;
};

export type DocxPartInfo = {
  number: number;
  total: number;
  firstChapter: number;
  lastChapter: number;
};

export type DocxPartIo = {
  readStaged: (position: number) => Promise<{ title: string; content: string }>;
  writeText: (path: string, text: string) => Promise<void>;
  appendText: (path: string, text: string) => Promise<void>;
};

const SECTION = `<w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>`;

export async function writeDocxPart(
  meta: DocxPartMeta,
  part: DocxPartInfo,
  io: DocxPartIo,
): Promise<string[]> {
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";
  const partTitle = `${displayTitle} (Part ${part.number} of ${part.total})`;
  const written: string[] = [];

  const write = async (path: string, text: string) => {
    await io.writeText(path, text);
    written.push(path);
  };

  // 1. Fixed package parts.
  await write("[Content_Types].xml", CONTENT_TYPES);
  await write("_rels/.rels", ROOT_RELS);
  await write(
    "docProps/core.xml",
    coreXml({
      title: partTitle,
      author: displayAuthor,
      modified: meta.modified,
    }),
  );
  await write("word/styles.xml", STYLES);
  await write("word/_rels/document.xml.rels", DOCUMENT_RELS);

  // 2. Document opening and title block.
  const documentPath = "word/document.xml";
  await write(
    documentPath,
    `${XML_DECL}
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">
  <w:body>
    ${paragraph([partTitle], { style: "Title" })}
    ${paragraph([`by ${displayAuthor}`], { style: "Subtitle" })}
    ${paragraph([`Chapters ${part.firstChapter} to ${part.lastChapter}`], { style: "Subtitle" })}
`,
  );

  // 3. Chapters, one at a time, appended to the document body.
  for (
    let position = part.firstChapter;
    position <= part.lastChapter;
    position++
  ) {
    const staged = await io.readStaged(position);
    const heading = staged.title.trim() || `Chapter ${position}`;
    const lines: string[] = [
      paragraph([heading], { style: "Heading1", pageBreakBefore: true }),
    ];
    for (const paragraphLines of splitParagraphs(staged.content)) {
      lines.push(paragraph(paragraphLines));
    }
    await io.appendText(documentPath, lines.join("\n") + "\n");
  }

  // 4. Close the body and the document.
  await io.appendText(
    documentPath,
    `    ${SECTION}
  </w:body>
</w:document>
`,
  );

  return written;
}
