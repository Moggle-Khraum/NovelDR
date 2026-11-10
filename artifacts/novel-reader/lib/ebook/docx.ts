// DOCX (Office Open XML) package builder.
//
// Returns the complete file set of a .docx as { path: text }. Packaging into a
// ZIP is done separately (see package.ts). Element order inside pPr, rPr, and
// sectPr follows the OOXML schema, because Word rejects some out-of-order files.

import { isoSeconds, splitParagraphs, xmlText } from "./xml";
import type { EbookChapter } from "./epub";

export type DocxMeta = {
  title: string;
  author: string;
  modified?: Date;
};

export const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
export const W_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const CONTENT_TYPES = `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>
`;

export const ROOT_RELS = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
`;

export const DOCUMENT_RELS = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>
</Relationships>
`;

// Built-in style ids and names (Title, Subtitle, heading 1) are used so Word's
// navigation pane and outline pick up chapter headings.
export const STYLES = `${XML_DECL}
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="336" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="2880" w:after="240"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="48"/>
      <w:szCs w:val="48"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="480" w:after="240"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
</w:styles>
`;

function runsForLines(lines: string[]): string {
  return lines
    .map((line, index) => {
      const br = index > 0 ? "<w:br/>" : "";
      return `${br}<w:t xml:space="preserve">${xmlText(line)}</w:t>`;
    })
    .join("");
}

export function paragraph(
  lines: string[],
  options: { style?: string; pageBreakBefore?: boolean } = {},
): string {
  const pPrParts: string[] = [];
  if (options.style) pPrParts.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.pageBreakBefore) pPrParts.push(`<w:pageBreakBefore/>`);
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${runsForLines(lines)}</w:r></w:p>`;
}

function documentXml(meta: DocxMeta, chapters: EbookChapter[]): string {
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";

  const body: string[] = [];
  body.push(paragraph([displayTitle], { style: "Title" }));
  body.push(paragraph([`by ${displayAuthor}`], { style: "Subtitle" }));

  chapters.forEach((chapter, index) => {
    const heading = chapter.title.trim() || `Chapter ${index + 1}`;
    body.push(
      paragraph([heading], { style: "Heading1", pageBreakBefore: true }),
    );
    for (const lines of splitParagraphs(chapter.content)) {
      body.push(paragraph(lines));
    }
  });

  // Page setup: US Letter, 1 inch margins.
  const sectPr = `<w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>`;

  return `${XML_DECL}
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">
  <w:body>
    ${body.join("\n    ")}
    ${sectPr}
  </w:body>
</w:document>
`;
}

export function coreXml(meta: DocxMeta): string {
  const stamp = isoSeconds(meta.modified);
  return `${XML_DECL}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlText(meta.title.trim() || "Untitled")}</dc:title>
  <dc:creator>${xmlText(meta.author.trim() || "Unknown author")}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>
`;
}

export function buildDocxFiles(
  meta: DocxMeta,
  chapters: EbookChapter[],
): Record<string, string> {
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "docProps/core.xml": coreXml(meta),
    "word/document.xml": documentXml(meta, chapters),
    "word/styles.xml": STYLES,
    "word/_rels/document.xml.rels": DOCUMENT_RELS,
  };
}
