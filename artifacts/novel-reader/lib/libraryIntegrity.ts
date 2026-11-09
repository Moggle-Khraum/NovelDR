// Library integrity check.
//
// Read-only. It compares what the library expects on disk (the same novels
// and chapter paths the storage estimate uses) with what is actually there,
// and returns a list of issues. Nothing is changed here.
//
// Repairs are separate and run only from an explicit user tap. Only the
// issues marked `removable` can be removed, and only the ones returned by a
// fresh check at the moment of the tap.

import {
  joinPath,
  listSafe,
  type NovelInput,
  type StorageAdapter,
} from "./storageStats";

export type IntegrityIssueKind =
  "missingChapterFile" | "leftoverFile" | "unlinkedFolder" | "needsAttention";

export type IntegrityIssue = {
  kind: IntegrityIssueKind;
  reason: string;
  // True only for leftover files and unlinked folders, which no part of the
  // library refers to. Missing chapters and everything needing attention are
  // never removable.
  removable: boolean;
  novelId?: string;
  title?: string;
  chapterIndex?: number;
  path?: string;
};

export type IntegrityReport = {
  checkedAt: number;
  novelsChecked: number;
  issues: IntegrityIssue[];
  missingChapterFiles: number;
  leftoverFiles: number;
  unlinkedFolders: number;
  needsAttention: number;
};

export type IntegrityInput = {
  novels: NovelInput[];
  // Novel ids listed in the library index file on disk. Null when the index
  // could not be read. Then nothing is known about ownership, so no folder is
  // treated as unlinked and nothing becomes removable.
  indexIds: string[] | null;
  // The app data folder (the one that holds chapters/ and novels/).
  appDataDir: string;
};

// Folder used by an interrupted chapter re-index (see updates and LibraryContext).
const REINDEX_STAGING = ".reindex";

export async function checkLibraryIntegrity(
  adapter: StorageAdapter,
  input: IntegrityInput,
): Promise<IntegrityReport> {
  const chaptersRoot = joinPath(input.appDataDir, "chapters");
  const recordsRoot = joinPath(input.appDataDir, "novels");
  const knownIds = new Set(input.novels.map((n) => n.id));
  const indexKnown = input.indexIds !== null;
  const indexIds = new Set(input.indexIds ?? []);
  const issues: IntegrityIssue[] = [];

  // 1. Each novel the library loaded: its chapter folder and details file.
  for (const novel of input.novels) {
    const folder = joinPath(chaptersRoot, novel.id);
    const listing = await listSafe(adapter, folder);
    const title = novel.title;

    if (!listing.ok) {
      issues.push({
        kind: "needsAttention",
        reason: "The chapter folder could not be read.",
        removable: false,
        novelId: novel.id,
        title,
        path: folder,
      });
    } else {
      const present = new Set(listing.names);
      const expected = new Set<string>();

      for (let i = 0; i < novel.chapterCount; i++) {
        const name = `chapter_${i}.json`;
        expected.add(name);
        if (!present.has(name)) {
          issues.push({
            kind: "missingChapterFile",
            reason:
              "The library expects this chapter file, but it is not on disk.",
            removable: false,
            novelId: novel.id,
            title,
            chapterIndex: i,
            path: joinPath(folder, name),
          });
        }
      }

      for (const name of listing.names) {
        if (expected.has(name)) continue;
        const path = joinPath(folder, name);

        if (name === REINDEX_STAGING) {
          issues.push({
            kind: "needsAttention",
            reason:
              "An update was interrupted while moving chapter files. This folder may hold the only copy of some chapters, so it is not removed.",
            removable: false,
            novelId: novel.id,
            title,
            path,
          });
          continue;
        }

        const entry = await adapter.stat(path).catch(() => null);
        if (!entry) {
          issues.push({
            kind: "needsAttention",
            reason: "This item could not be read, so it is not removed.",
            removable: false,
            novelId: novel.id,
            title,
            path,
          });
        } else if (entry.isDirectory) {
          issues.push({
            kind: "needsAttention",
            reason:
              "An unexpected folder sits inside this novel's chapter folder.",
            removable: false,
            novelId: novel.id,
            title,
            path,
          });
        } else {
          issues.push({
            kind: "leftoverFile",
            reason:
              "This file is not a chapter the library expects for this novel.",
            removable: true,
            novelId: novel.id,
            title,
            path,
          });
        }
      }
    }

    const record = await adapter
      .stat(joinPath(recordsRoot, `${novel.id}.json`))
      .catch(() => null);
    if (!record || !record.exists) {
      issues.push({
        kind: "needsAttention",
        reason:
          "This novel is loaded, but its details file is missing. It may not load after a restart.",
        removable: false,
        novelId: novel.id,
        title,
        path: joinPath(recordsRoot, `${novel.id}.json`),
      });
    }
  }

  // 2. Chapter folders that no loaded novel refers to.
  const rootListing = await listSafe(adapter, chaptersRoot);
  if (!rootListing.ok) {
    issues.push({
      kind: "needsAttention",
      reason: "The chapters folder could not be read.",
      removable: false,
      path: chaptersRoot,
    });
  }
  for (const name of rootListing.names) {
    if (knownIds.has(name)) continue;
    const path = joinPath(chaptersRoot, name);
    const entry = await adapter.stat(path).catch(() => null);
    if (!entry || !entry.exists) continue;

    if (!entry.isDirectory) {
      issues.push({
        kind: "needsAttention",
        reason: "A loose file sits in the chapters folder.",
        removable: false,
        path,
      });
      continue;
    }

    const hasRecord =
      (
        await adapter
          .stat(joinPath(recordsRoot, `${name}.json`))
          .catch(() => null)
      )?.exists ?? false;
    if (hasRecord) {
      issues.push({
        kind: "needsAttention",
        reason:
          "This folder has a details file, but the novel did not load. It may be damaged, so it is not removed.",
        removable: false,
        novelId: name,
        path,
      });
    } else if (!indexKnown) {
      issues.push({
        kind: "needsAttention",
        reason:
          "The library index could not be read, so this folder is not removed.",
        removable: false,
        novelId: name,
        path,
      });
    } else if (indexIds.has(name)) {
      issues.push({
        kind: "needsAttention",
        reason:
          "This folder is listed in the library index, but the novel did not load. It is not removed.",
        removable: false,
        novelId: name,
        path,
      });
    } else {
      issues.push({
        kind: "unlinkedFolder",
        reason: "No novel in the library refers to this folder.",
        removable: true,
        novelId: name,
        path,
      });
    }
  }

  // 3. Details files for novels that did not load.
  const recordListing = await listSafe(adapter, recordsRoot);
  for (const name of recordListing.names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (knownIds.has(id)) continue;
    issues.push({
      kind: "needsAttention",
      reason: indexIds.has(id)
        ? "This novel is listed in the library index, but its details did not load. It is not removed."
        : "A details file exists for a novel that did not load. It is not removed.",
      removable: false,
      novelId: id,
      path: joinPath(recordsRoot, name),
    });
  }

  const count = (kind: IntegrityIssueKind) =>
    issues.filter((i) => i.kind === kind).length;
  return {
    checkedAt: Date.now(),
    novelsChecked: input.novels.length,
    issues,
    missingChapterFiles: count("missingChapterFile"),
    leftoverFiles: count("leftoverFile"),
    unlinkedFolders: count("unlinkedFolder"),
    needsAttention: count("needsAttention"),
  };
}

// Removes the removable issues from the given list, using the caller's
// remove function. Never removes anything that is not marked removable.
// Pass only issues from a fresh check made at the moment of the tap.
export async function removeRemovableIssues(
  issues: IntegrityIssue[],
  remove: (path: string) => Promise<void>,
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const issue of issues) {
    if (!issue.removable || !issue.path) continue;
    try {
      await remove(issue.path);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
