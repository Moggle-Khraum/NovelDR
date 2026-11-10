// Long-novel export orchestrator.
//
// Ties together the plan, the runner, the format part writers, and packaging.
// Each part is built in a small in-memory buffer (a part is capped at a few MB
// of text), then written to disk by the adapter. Chapters are read from staging
// one at a time, so the whole novel is never held in memory.
//
// File access is injected through LongExportAdapters, so the same logic runs in
// tests (against real files in Node) and on the device (expo-file-system).

import { planExport, type PlannedChapter } from "./exportPlan";
import {
  runLongExport,
  type ExportEvent,
  type ExportProgress,
  type RunnerResult,
} from "./exportRunner";
import { writeEpubPart } from "./ebook/epubPart";
import { writeDocxPart } from "./ebook/docxPart";
import { writeTxtPart, writeRtfPart } from "./textPart";
import { packagePart } from "./ebook/partPackage";

export type LongFormat = "epub" | "docx" | "txt" | "rtf";

export const FORMAT_EXTENSION: Record<LongFormat, string> = {
  epub: ".epub",
  docx: ".docx",
  txt: ".txt",
  rtf: ".rtf",
};

export const FORMAT_MIME: Record<LongFormat, string> = {
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  rtf: "application/rtf",
};

export type SourceChapter = {
  index: number;
  title: string;
  bytes: number;
};

export type LongExportAdapters = {
  freeBytes: () => Promise<number>;
  // Reads one chapter from the library's own chapter files, by position.
  readSource: (
    position: number,
  ) => Promise<{ title: string; content: string } | null>;
  // Chapter staging (one JSON file per chapter).
  stage: (
    partNumber: number,
    position: number,
    title: string,
    content: string,
  ) => Promise<void>;
  readStaged: (position: number) => Promise<{ title: string; content: string }>;
  // Writes a text or base64 file at an absolute path under the export folder.
  writeText: (path: string, text: string) => Promise<void>;
  writeBase64: (path: string, base64: string) => Promise<void>;
  moveFile: (from: string, to: string) => Promise<void>;
  deleteDir: (path: string) => Promise<void>;
  // Zips finished part files with a note into one shareable archive. Returns its path.
  zipFinished: (
    files: string[],
    note: string,
    zipPath: string,
  ) => Promise<string>;
  // Reads back a file's base64 (used to zip binary parts).
  readBase64: (path: string) => Promise<string>;
};

export type LongExportInput = {
  novelId: string;
  title: string;
  author: string;
  format: LongFormat;
  chapters: SourceChapter[];
  // Base folder for this novel's export, e.g. "<documentDirectory>exports/Title/".
  baseDir: string;
  // Zip file path for the finished parts, e.g. "<documentDirectory>exports/Title.zip".
  zipPath: string;
  estimatedOutputBytes?: number;
  isCancelled: () => boolean;
  onEvent?: (event: ExportEvent) => void;
  onProgress?: (progress: ExportProgress) => void;
};

export function partFolder(baseDir: string, partNumber: number): string {
  return `${baseDir}parts/part-${partNumber}/`;
}

async function buildPartArtifact(
  input: LongExportInput,
  adapters: LongExportAdapters,
  partNumber: number,
  partTotal: number,
  partInfo: { firstChapter: number; lastChapter: number },
): Promise<string> {
  const folder = partFolder(input.baseDir, partNumber);
  const info = { number: partNumber, total: partTotal, ...partInfo };
  const meta = { id: input.novelId, title: input.title, author: input.author };
  const buffers = new Map<string, string>();
  const append = async (path: string, text: string) => {
    buffers.set(path, (buffers.get(path) ?? "") + text);
  };
  const put = async (path: string, text: string) => {
    buffers.set(path, text);
  };

  if (input.format === "epub") {
    const io = {
      readStaged: adapters.readStaged,
      writeText: put,
    };
    const entries = await writeEpubPart(meta, info, io);
    const base64 = await packagePart(
      entries,
      async (rel) => buffers.get(rel) ?? "",
      FORMAT_MIME.epub,
    );
    const temp = `${folder}artifact${FORMAT_EXTENSION.epub}`;
    await adapters.writeBase64(temp, base64);
    return temp;
  }

  if (input.format === "docx") {
    const io = {
      readStaged: adapters.readStaged,
      writeText: put,
      appendText: append,
    };
    const entries = await writeDocxPart(meta, info, io);
    const base64 = await packagePart(
      entries,
      async (rel) => buffers.get(rel) ?? "",
      FORMAT_MIME.docx,
    );
    const temp = `${folder}artifact${FORMAT_EXTENSION.docx}`;
    await adapters.writeBase64(temp, base64);
    return temp;
  }

  // TXT and RTF: a single text file per part.
  const textPath = "part-text";
  const io = { readStaged: adapters.readStaged, appendText: append };
  if (input.format === "txt") {
    await writeTxtPart(meta, info, io, textPath);
  } else {
    await writeRtfPart(meta, info, io, textPath);
  }
  const temp = `${folder}artifact${FORMAT_EXTENSION[input.format]}`;
  await adapters.writeText(temp, buffers.get(textPath) ?? "");
  return temp;
}

export async function runLongNovelExport(
  input: LongExportInput,
  adapters: LongExportAdapters,
): Promise<RunnerResult> {
  const planned: PlannedChapter[] = input.chapters.map((c) => ({
    index: c.index,
    title: c.title,
    bytes: c.bytes,
  }));
  const plan = planExport(planned);
  const ext = FORMAT_EXTENSION[input.format];

  return runLongExport(
    plan,
    {
      freeBytes: adapters.freeBytes,
      readChapter: async (position) => adapters.readSource(position),
      stageChapter: adapters.stage,
      buildPart: (partNumber, partTotal) => {
        const part = plan.parts[partNumber - 1];
        return buildPartArtifact(input, adapters, partNumber, partTotal, {
          firstChapter: part.firstChapter,
          lastChapter: part.lastChapter,
        });
      },
      finishPart: async (tempPath, partNumber) => {
        const finalPath = `${input.baseDir}part-${partNumber}${ext}`;
        await adapters.moveFile(tempPath, finalPath);
        await adapters.deleteDir(partFolder(input.baseDir, partNumber));
        return finalPath;
      },
      discardPart: (partNumber) =>
        adapters.deleteDir(partFolder(input.baseDir, partNumber)),
      zipParts: (files, note) =>
        adapters.zipFinished(files, note, input.zipPath),
    },
    {
      isCancelled: input.isCancelled,
      estimatedOutputBytes: input.estimatedOutputBytes,
      onEvent: input.onEvent,
      onProgress: input.onProgress,
    },
  );
}
