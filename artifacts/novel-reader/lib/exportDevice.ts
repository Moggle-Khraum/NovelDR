// Device implementation of the long-novel export adapters.
//
// Implements LongExportAdapters (lib/longExport.ts) with expo-file-system. Nothing
// here has been run on a device yet. It is checked for syntax and matched to the
// interface the tested orchestrator uses.
//
// Decision for review: the outer zip (the finished parts plus the note) is made
// with the native library from disk, not JSZip. A novel's finished parts can add
// up to far more than one part, and JSZip would hold all of them in memory.
// Parts themselves are still packaged with JSZip (see lib/ebook/partPackage.ts).

import * as FileSystem from "expo-file-system/legacy";
import type { LongExportAdapters } from "./longExport";

const TEXT = { encoding: FileSystem.EncodingType.UTF8 };

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

async function ensureParent(path: string) {
  const dir = parentOf(path);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export function createDeviceAdapters(input: {
  // Folder for staged chapters, e.g. "<documentDirectory>exports/<novel>/staging/".
  stagingDir: string;
  // Reads a chapter from the library's own chapter files, by index.
  readLibraryChapter: (
    index: number,
  ) => Promise<{ title: string; content: string } | null>;
}): LongExportAdapters {
  return {
    freeBytes: async () => FileSystem.getFreeDiskStorageAsync(),

    readSource: input.readLibraryChapter,

    stage: async (partNumber, position, title, content) => {
      const path = `${input.stagingDir}${position}.json`;
      await ensureParent(path);
      await FileSystem.writeAsStringAsync(
        path,
        JSON.stringify({ partNumber, title, content }),
        TEXT,
      );
    },

    readStaged: async (position) => {
      const raw = await FileSystem.readAsStringAsync(
        `${input.stagingDir}${position}.json`,
        TEXT,
      );
      const parsed = JSON.parse(raw);
      return { title: parsed.title, content: parsed.content };
    },

    writeText: async (path, text) => {
      await ensureParent(path);
      await FileSystem.writeAsStringAsync(path, text, TEXT);
    },

    writeBase64: async (path, base64) => {
      await ensureParent(path);
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    },

    moveFile: async (from, to) => {
      await ensureParent(to);
      await FileSystem.moveAsync({ from, to });
    },

    deleteDir: async (path) => {
      await FileSystem.deleteAsync(path, { idempotent: true });
    },

    readBase64: async (path) =>
      FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.Base64,
      }),

    zipFinished: async (files, note, zipPath) => {
      // The note sits next to the zip, is added to it, then removed.
      const notePath = `${parentOf(zipPath)}NOTE.txt`;
      await FileSystem.writeAsStringAsync(notePath, note, TEXT);
      try {
        const { zip } = await import("react-native-zip-archive");
        return await zip([...files, notePath], zipPath);
      } finally {
        await FileSystem.deleteAsync(notePath, { idempotent: true });
      }
    },
  };
}
