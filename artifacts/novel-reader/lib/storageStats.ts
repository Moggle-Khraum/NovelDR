// Storage estimate for Library Statistics.
//
// Follows the same model the app uses to read its data:
// - Novels come from the library itself (the same list the app loads).
// - A novel's chapters are the files chapters/<novelId>/chapter_<n>.json, for
//   n = 0 .. chapterCount-1, as LibraryContext writes and reads them.
// - Sizes are read with stat calls only, like the backup size estimate. Nothing
//   is copied or opened.
//
// On demand only: nothing here runs in the background. The filesystem is passed
// in as an adapter, so the logic can be tested without the device.

export type FileStat = {
  exists: boolean;
  isDirectory: boolean;
  size: number;
};

export type StorageAdapter = {
  stat(path: string): Promise<FileStat>;
  list(path: string): Promise<string[]>;
};

export type NovelInput = {
  id: string;
  title: string;
  chapterCount: number;
};

export type StorageLocations = {
  // The app's data folder (the one that holds chapters/ and novels/).
  appDataDir: string;
  coversDir: string;
  backupsDir: string;
  exportsDir: string;
  updatesDir: string;
};

export type StorageCategoryKey =
  | "chapters"
  | "novelDetails"
  | "leftovers"
  | "covers"
  | "backups"
  | "exports"
  | "updates"
  | "otherAppData";

export type StorageCategory = {
  key: StorageCategoryKey;
  label: string;
  bytes: number;
};

export type NovelStorage = {
  id: string;
  title: string;
  bytes: number;
  chapterCount: number;
  missingChapters: number;
};

export type LibraryStorageReport = {
  measuredAt: number;
  totalBytes: number;
  categories: StorageCategory[];
  novels: NovelStorage[];
  // Expected chapter files that are present.
  chapterFiles: number;
  // Expected chapter files that are not on disk.
  missingChapterFiles: number;
  // Files in a novel folder that the library does not expect.
  leftoverFiles: number;
  // Chapter folders that match no novel in the library.
  orphanFolders: number;
  // Folders that exist but could not be read. Totals may be low when > 0.
  skipped: number;
};

const MAX_DEPTH = 4;

export function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

// Like the backup estimate, but tolerant: a missing folder is zero, and an
// unreadable one is counted as skipped.
export async function listSafe(
  adapter: StorageAdapter,
  path: string,
): Promise<{ names: string[]; ok: boolean }> {
  try {
    const stat = await adapter.stat(path);
    if (!stat.exists) return { names: [], ok: true };
    return { names: await adapter.list(path), ok: true };
  } catch {
    return { names: [], ok: false };
  }
}

// Size of one file, or zero if it is missing or unreadable.
export async function fileBytes(
  adapter: StorageAdapter,
  path: string,
): Promise<{ bytes: number; skipped: number }> {
  try {
    const stat = await adapter.stat(path);
    if (!stat.exists || stat.isDirectory) return { bytes: 0, skipped: 0 };
    return { bytes: stat.size || 0, skipped: 0 };
  } catch {
    return { bytes: 0, skipped: 1 };
  }
}

// Total size of a folder, including subfolders up to MAX_DEPTH. Mirrors the
// backup estimate: list the folder, then stat each entry.
async function folderBytes(
  adapter: StorageAdapter,
  path: string,
  depth = 0,
): Promise<{ bytes: number; files: number; skipped: number }> {
  if (depth > MAX_DEPTH) return { bytes: 0, files: 0, skipped: 1 };
  const listing = await listSafe(adapter, path);
  if (!listing.ok) return { bytes: 0, files: 0, skipped: 1 };
  let bytes = 0;
  let files = 0;
  let skipped = 0;
  for (const name of listing.names) {
    const child = joinPath(path, name);
    let stat: FileStat;
    try {
      stat = await adapter.stat(child);
    } catch {
      skipped++;
      continue;
    }
    if (!stat.exists) continue;
    if (stat.isDirectory) {
      const inner = await folderBytes(adapter, child, depth + 1);
      bytes += inner.bytes;
      files += inner.files;
      skipped += inner.skipped;
    } else {
      bytes += stat.size || 0;
      files += 1;
    }
  }
  return { bytes, files, skipped };
}

// Size of a file or a folder, whichever the path is. Files are never listed.
async function entryBytes(
  adapter: StorageAdapter,
  path: string,
): Promise<{
  exists: boolean;
  isDirectory: boolean;
  bytes: number;
  files: number;
  skipped: number;
}> {
  let stat: FileStat;
  try {
    stat = await adapter.stat(path);
  } catch {
    return { exists: false, isDirectory: false, bytes: 0, files: 0, skipped: 1 };
  }
  if (!stat.exists) {
    return { exists: false, isDirectory: false, bytes: 0, files: 0, skipped: 0 };
  }
  if (!stat.isDirectory) {
    return { exists: true, isDirectory: false, bytes: stat.size || 0, files: 1, skipped: 0 };
  }
  const folder = await folderBytes(adapter, path);
  return { exists: true, isDirectory: true, ...folder };
}

// Estimates storage used by the library. Each file is counted once.
export async function estimateLibraryStorage(
  adapter: StorageAdapter,
  input: { novels: NovelInput[]; locations: StorageLocations },
): Promise<LibraryStorageReport> {
  const { novels, locations } = input;
  const chaptersRoot = joinPath(locations.appDataDir, "chapters");
  const recordsRoot = joinPath(locations.appDataDir, "novels");

  let skipped = 0;
  let chapterBytes = 0;
  let chapterFiles = 0;
  let missingChapterFiles = 0;
  let leftoverBytes = 0;
  let leftoverFiles = 0;
  let recordBytes = 0;
  const perNovel: NovelStorage[] = [];
  const knownIds = new Set<string>();

  // 1. Each novel the library knows about, read the way the app reads it.
  for (const novel of novels) {
    knownIds.add(novel.id);
    const folder = joinPath(chaptersRoot, novel.id);
    const listing = await listSafe(adapter, folder);
    if (!listing.ok) skipped++;

    const present = new Set(listing.names);
    const expected = new Set<string>();
    let novelChapterBytes = 0;
    let missing = 0;

    for (let i = 0; i < novel.chapterCount; i++) {
      const name = `chapter_${i}.json`;
      expected.add(name);
      if (!present.has(name)) {
        missing++;
        continue;
      }
      const f = await fileBytes(adapter, joinPath(folder, name));
      skipped += f.skipped;
      novelChapterBytes += f.bytes;
      chapterFiles++;
    }
    missingChapterFiles += missing;
    chapterBytes += novelChapterBytes;

    // Files in the folder that the library does not expect.
    let novelLeftoverBytes = 0;
    for (const name of listing.names) {
      if (expected.has(name)) continue;
      const f = await fileBytes(adapter, joinPath(folder, name));
      skipped += f.skipped;
      novelLeftoverBytes += f.bytes;
      leftoverFiles++;
    }
    leftoverBytes += novelLeftoverBytes;

    const record = await fileBytes(adapter, joinPath(recordsRoot, `${novel.id}.json`));
    skipped += record.skipped;
    recordBytes += record.bytes;

    perNovel.push({
      id: novel.id,
      title: novel.title,
      bytes: novelChapterBytes + novelLeftoverBytes + record.bytes,
      chapterCount: novel.chapterCount,
      missingChapters: missing,
    });
  }

  // 2. Chapter folders with no matching novel.
  const chapterListing = await listSafe(adapter, chaptersRoot);
  if (!chapterListing.ok) skipped++;
  let orphanFolders = 0;
  let orphanBytes = 0;
  for (const name of chapterListing.names) {
    if (knownIds.has(name)) continue;
    const entry = await entryBytes(adapter, joinPath(chaptersRoot, name));
    skipped += entry.skipped;
    if (!entry.exists) continue;
    if (entry.isDirectory) {
      orphanFolders++;
      orphanBytes += entry.bytes;
      leftoverFiles += entry.files;
    } else {
      // A stray file directly in the chapters folder.
      orphanBytes += entry.bytes;
      leftoverFiles += 1;
    }
  }

  // 3. Covers, backups, exports, and updates: each folder's total.
  const covers = await folderBytes(adapter, locations.coversDir);
  const backups = await folderBytes(adapter, locations.backupsDir);
  const exports = await folderBytes(adapter, locations.exportsDir);
  const updates = await folderBytes(adapter, locations.updatesDir);
  skipped += covers.skipped + backups.skipped + exports.skipped + updates.skipped;

  // 4. Everything else in the app folder: all children except chapters/ and novels/.
  const appListing = await listSafe(adapter, locations.appDataDir);
  if (!appListing.ok) skipped++;
  let otherBytes = 0;
  for (const name of appListing.names) {
    if (name === "chapters" || name === "novels") continue;
    const entry = await entryBytes(adapter, joinPath(locations.appDataDir, name));
    otherBytes += entry.bytes;
    skipped += entry.skipped;
  }

  const categories: StorageCategory[] = [
    { key: "chapters", label: "Chapter text", bytes: chapterBytes },
    { key: "novelDetails", label: "Novel details", bytes: recordBytes },
    { key: "leftovers", label: "Leftover files", bytes: leftoverBytes + orphanBytes },
    { key: "covers", label: "Cover images", bytes: covers.bytes },
    { key: "backups", label: "Backups", bytes: backups.bytes },
    { key: "exports", label: "Exported files", bytes: exports.bytes },
    { key: "updates", label: "Update downloads", bytes: updates.bytes },
    { key: "otherAppData", label: "Library index and other data", bytes: otherBytes },
  ];
  const totalBytes = categories.reduce((sum, c) => sum + c.bytes, 0);

  return {
    measuredAt: Date.now(),
    totalBytes,
    categories,
    novels: perNovel.sort((a, b) => b.bytes - a.bytes),
    chapterFiles,
    missingChapterFiles,
    leftoverFiles,
    orphanFolders,
    skipped,
  };
}

// Human-readable size, using 1024-based units.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
