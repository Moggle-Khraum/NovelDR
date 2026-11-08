// Refills chapter files the library expects but cannot find on disk.
//
// Runs only when the user asks for it. For each missing chapter it fetches the
// chapter by the URL the library already stores for that chapter, then saves
// it at the same index. It never touches a chapter that is already on disk,
// never changes the chapter list, and never deletes anything.
//
// The fetch function is supplied by the app (fetchChapter from hooks/useApi),
// which already retries and falls back between direct, proxy, and external
// scraper routes. Chapters are fetched one at a time, to be gentle on sites.

import type { IntegrityIssue } from "./libraryIntegrity";
import { parseChapterNumber } from "./chapterOrder";

export type RefillTarget = {
  novelId: string;
  novelTitle: string;
  index: number;
  url: string;
  title: string;
  chapterNumber: number;
};

export type RefillDeps = {
  fetch: (url: string, chapterNumber: number) => Promise<{ title: string; content: string }>;
  save: (target: RefillTarget, title: string, content: string) => Promise<void>;
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number) => void;
};

export type RefillResult = {
  filled: number;
  failed: { novelTitle: string; index: number; reason: string }[];
  stopped: boolean;
};

export type RefillNovel = {
  id: string;
  title: string;
  chapters: { title: string; url: string; chapterNumber?: number }[];
};

// Builds one target per missing chapter, using the stored URL and title.
// Missing chapters with no stored URL are kept, so they show up as failures
// with a clear reason instead of disappearing.
export function buildRefillTargets(
  issues: IntegrityIssue[],
  novels: RefillNovel[],
): RefillTarget[] {
  const byId = new Map(novels.map((n) => [n.id, n]));
  const targets: RefillTarget[] = [];
  for (const issue of issues) {
    if (issue.kind !== "missingChapterFile" || issue.novelId === undefined) continue;
    if (issue.chapterIndex === undefined) continue;
    const novel = byId.get(issue.novelId);
    if (!novel) continue;
    const chapter = novel.chapters[issue.chapterIndex];
    targets.push({
      novelId: novel.id,
      novelTitle: novel.title,
      index: issue.chapterIndex,
      url: chapter?.url ?? "",
      title: chapter?.title ?? `Chapter ${issue.chapterIndex + 1}`,
      chapterNumber:
        chapter?.chapterNumber ??
        parseChapterNumber(chapter?.title) ??
        issue.chapterIndex + 1,
    });
  }
  return targets;
}

export async function refillChapters(
  targets: RefillTarget[],
  deps: RefillDeps,
): Promise<RefillResult> {
  const failed: RefillResult["failed"] = [];
  let filled = 0;
  let stopped = false;

  for (let i = 0; i < targets.length; i++) {
    if (deps.shouldStop?.()) {
      stopped = true;
      break;
    }
    const target = targets[i];
    deps.onProgress?.(i, targets.length);

    if (!target.url) {
      failed.push({
        novelTitle: target.novelTitle,
        index: target.index,
        reason: "No saved address for this chapter, so it cannot be fetched.",
      });
      continue;
    }

    try {
      const data = await deps.fetch(target.url, target.chapterNumber);
      if (!data.content || data.content.trim().length === 0) {
        failed.push({
          novelTitle: target.novelTitle,
          index: target.index,
          reason: "The site returned no text for this chapter.",
        });
        continue;
      }
      await deps.save(target, data.title || target.title, data.content);
      filled++;
    } catch (error: any) {
      failed.push({
        novelTitle: target.novelTitle,
        index: target.index,
        reason: error?.message || "The chapter could not be fetched.",
      });
    }
  }

  deps.onProgress?.(targets.length, targets.length);
  return { filled, failed, stopped };
}
