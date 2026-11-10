// Export planning.
//
// Decides how a novel is exported and how its chapters are grouped:
// - Standard: fewer chapters than the threshold. One file, as before.
// - Long: at or above the threshold. Chapters are grouped into parts by a byte
//   budget, and each part is written and packaged on its own. This keeps memory
//   low on low-end phones.
//
// Pure functions only, so the grouping can be tested without the device.

// Long-novel threshold, in chapters. Chosen conservatively: low-end phones
// struggle well before 150 chapters.
export const LONG_NOVEL_CHAPTERS = 50;

// Target text size per part, in bytes. A single chapter larger than this is
// still kept whole, in a part of its own.
export const PART_BUDGET_BYTES = 6 * 1024 * 1024;

export type PlannedChapter = {
  index: number;
  title: string;
  bytes: number;
};

export type ExportPart = {
  // 1-based part number.
  number: number;
  total: number;
  chapters: PlannedChapter[];
  bytes: number;
  // Chapter position range in the novel (1-based, inclusive).
  firstChapter: number;
  lastChapter: number;
};

export type ExportPlan = {
  mode: "standard" | "long";
  chapterCount: number;
  totalBytes: number;
  parts: ExportPart[];
};

export function planExport(
  chapters: PlannedChapter[],
  options: { longThreshold?: number; partBudget?: number } = {},
): ExportPlan {
  const threshold = options.longThreshold ?? LONG_NOVEL_CHAPTERS;
  const budget = options.partBudget ?? PART_BUDGET_BYTES;
  const totalBytes = chapters.reduce((sum, c) => sum + c.bytes, 0);
  const mode: ExportPlan["mode"] =
    chapters.length >= threshold ? "long" : "standard";

  if (chapters.length === 0) {
    return { mode, chapterCount: 0, totalBytes: 0, parts: [] };
  }

  // Standard exports are always one part, however large.
  if (mode === "standard") {
    return {
      mode,
      chapterCount: chapters.length,
      totalBytes,
      parts: [
        {
          number: 1,
          total: 1,
          chapters,
          bytes: totalBytes,
          firstChapter: 1,
          lastChapter: chapters.length,
        },
      ],
    };
  }

  // Long exports: greedy grouping in reading order. A chapter joins the current
  // part while the part stays within budget. A part always holds at least one
  // chapter, so a single oversized chapter gets a part of its own.
  const groups: PlannedChapter[][] = [];
  let current: PlannedChapter[] = [];
  let currentBytes = 0;
  for (const chapter of chapters) {
    const wouldExceed =
      current.length > 0 && currentBytes + chapter.bytes > budget;
    if (wouldExceed) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(chapter);
    currentBytes += chapter.bytes;
  }
  if (current.length > 0) groups.push(current);

  let position = 0;
  const parts: ExportPart[] = groups.map((group, i) => {
    const first = position + 1;
    position += group.length;
    return {
      number: i + 1,
      total: groups.length,
      chapters: group,
      bytes: group.reduce((sum, c) => sum + c.bytes, 0),
      firstChapter: first,
      lastChapter: position,
    };
  });

  return { mode, chapterCount: chapters.length, totalBytes, parts };
}
