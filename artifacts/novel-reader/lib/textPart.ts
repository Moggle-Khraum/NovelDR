// Writes one TXT or RTF part, one chapter at a time.
//
// Each part is a single text file. Chapters are read from staging one by one and
// appended, so the part never sits in memory as a whole. The layout matches the
// standard TXT and RTF exports.

import { escapeRTF } from "./rtf";

export type TextPartMeta = {
  title: string;
  author: string;
};

export type TextPartInfo = {
  number: number;
  total: number;
  firstChapter: number;
  lastChapter: number;
};

export type TextPartIo = {
  readStaged: (position: number) => Promise<{ title: string; content: string }>;
  appendText: (path: string, text: string) => Promise<void>;
};

const TITLE_PREFIX = "Chapters";

export async function writeTxtPart(
  meta: TextPartMeta,
  part: TextPartInfo,
  io: TextPartIo,
  path: string,
): Promise<void> {
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";
  const partTitle = `${displayTitle} (Part ${part.number} of ${part.total})`;

  await io.appendText(
    path,
    `${partTitle}\n` +
      `by ${displayAuthor}\n` +
      `${TITLE_PREFIX} ${part.firstChapter} to ${part.lastChapter}\n` +
      `${"=".repeat(50)}\n\n`,
  );

  for (
    let position = part.firstChapter;
    position <= part.lastChapter;
    position++
  ) {
    const staged = await io.readStaged(position);
    const heading = staged.title.trim() || `Chapter ${position}`;
    await io.appendText(
      path,
      `${heading}\n${"-".repeat(30)}\n\n${staged.content}\n\n\n`,
    );
  }
}

export async function writeRtfPart(
  meta: TextPartMeta,
  part: TextPartInfo,
  io: TextPartIo,
  path: string,
): Promise<void> {
  const displayTitle = meta.title.trim() || "Untitled";
  const displayAuthor = meta.author.trim() || "Unknown author";
  const partTitle = `${displayTitle} (Part ${part.number} of ${part.total})`;

  await io.appendText(
    path,
    `{\\rtf1\\ansi\\deff0\n` +
      `{\\fonttbl{\\f0 Times New Roman;}}\n` +
      `\\f0\\fs24\n` +
      `{\\b ${escapeRTF(partTitle)}}\\par\n` +
      `${escapeRTF(displayAuthor)}\\par\\par\n`,
  );

  for (
    let position = part.firstChapter;
    position <= part.lastChapter;
    position++
  ) {
    const staged = await io.readStaged(position);
    const heading = staged.title.trim() || `Chapter ${position}`;
    await io.appendText(
      path,
      `{\\b ${escapeRTF(heading)}}\\par\n` +
        `${escapeRTF(staged.content).replace(/\n/g, "\\par ")}` +
        `\\par\\par\n`,
    );
  }

  await io.appendText(path, `}`);
}
