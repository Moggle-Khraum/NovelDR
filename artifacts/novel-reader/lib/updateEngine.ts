import type { MutableRefObject } from "react";
import * as FileSystem from "expo-file-system/legacy";
import type { useLibrary } from "@/context/LibraryContext";
import { Novel, Chapter, ChapterFileMove } from "@/context/LibraryContext";
import { orderChapters } from "@/lib/chapterOrder";
import {
  extractChapterNumber,
  getNextStartChapter,
  chapterExists,
  tryDirectSkip,
  hostOf,
} from "@/lib/updateHelpers";

export { getNextStartChapter, hostOf };
import { fetchNovelMeta, fetchChapter } from "@/hooks/useApi";
import { CHAPTER_LIMIT_MAX } from "@/hooks/useChapterLimiter";
import { hasProtectedCover } from "@/hooks/scrapers/shared/webviewSites";
import { saveCoverViaWebView } from "@/hooks/scrapers/shared/coverFetch";
import { isHalted, resetHalt } from "@/hooks/scrapers/shared/haltControl";
import { endPausedSiteException } from "@/hooks/scrapers/shared/lowMemoryState";

export type LogEntry = {
  id: string;
  text: string;
  type: "info" | "downloading" | "success" | "error" | "warning";
};

type LogFn = (text: string, type?: LogEntry["type"]) => void;

// Fallback used when Max Chapters is left blank (mirrors Start Chapter's
// fallback to the next expected chapter).
export const DEFAULT_MAX_CHAPTERS = 30;

// Detects when a saved novel's sourceUrl is actually a chapter page rather than
// the novel's info/homepage page (can happen with novels added via a pasted
// chapter link before add.tsx started normalizing sourceUrl to the homepage).
const NOVEL_SOURCE_CHAPTER_PATTERN = /\/chapter[-/](\d+)/i;

type UpdateLibraryOps = Pick<
  ReturnType<typeof useLibrary>,
  | "updateNovel"
  | "saveAllChaptersToFile"
  | "applyChapterFileMoves"
  | "loadChapterContent"
>;

export type UpdateEngineInput = {
  novel: Novel;
  startChStr: string;
  maxChStr: string;
};

// Everything the engine needs from the screen. The engine holds no React
// state of its own; it reports through these callbacks.
export type UpdateEngineUi = {
  stopRef: MutableRefObject<boolean>;
  addLog: LogFn;
  clearLogs: () => void;
  setIsUpdating: (value: boolean) => void;
  setProgress: (value: number) => void;
  setProgressLabel: (value: string) => void;
  setElapsedTime: (value: string) => void;
  startTimer: () => void;
  stopTimer: () => void;
  library: UpdateLibraryOps;
};

// ─── Download cover ──────────────────────────────────────────────────────────
export const downloadAndSaveCover = async (
  log: LogFn,
  coverUrl: string,
  novelId: string,
): Promise<string> => {
  if (!coverUrl) return "";
  const coverDir = `${FileSystem.documentDirectory}covers/`;
  const coverPath = `${coverDir}${novelId}.jpg`;
  // Last resort: fetch the image from inside a WebView that passed the
  // Cloudflare challenge. If that fails too, the placeholder is used.
  const viaWebView = async (): Promise<string> => {
    try {
      return await saveCoverViaWebView(coverUrl, coverPath);
    } catch (err) {
      console.warn("Cover WebView fetch failed:", err);
      log(`Cover WebView fetch failed, using placeholder`, "warning");
      return "";
    }
  };
  if (hasProtectedCover(coverUrl)) return viaWebView();
  try {
    const dirInfo = await FileSystem.getInfoAsync(coverDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(coverDir, { intermediates: true });
    }
    const downloadResult = await FileSystem.downloadAsync(coverUrl, coverPath);
    log(`Cover image saved locally`, "success");
    return downloadResult.uri;
  } catch (err) {
    console.warn("Failed to download cover:", err);
    return viaWebView();
  }
};

// ─── Lightweight metadata fetch (next URL only, no content parsing) ──────────
// FIX: this used to hand-roll its own fetch() + regex HTML scrape for the
// "next chapter" link, which didn't know about per-site quirks (AJAX-loaded
// chapter lists, Cloudflare proxying, LNW's #chapterText selector, etc.)
// that fetchChapter() in useApi already handles. That mismatch is why
// updates.tsx failed on sites that worked fine in add.tsx. Now it just
// delegates to the same shared scraper add.tsx uses.
export const getChapterMetadata = async (
  url: string,
  chapterNum: number,
): Promise<{ nextUrl: string | null; title: string }> => {
  const data = await fetchChapter(url, chapterNum);
  return { nextUrl: data.nextUrl || null, title: data.title };
};

export async function runUpdate(
  input: UpdateEngineInput,
  ui: UpdateEngineUi,
): Promise<void> {
  const selectedNovel = input.novel;
  const { startChStr, maxChStr } = input;
  const {
    stopRef,
    addLog,
    clearLogs,
    setIsUpdating,
    setProgress,
    setProgressLabel,
    setElapsedTime,
    startTimer,
    stopTimer,
    library,
  } = ui;
  const {
    updateNovel,
    saveAllChaptersToFile,
    applyChapterFileMoves,
    loadChapterContent,
  } = library;
  const existingChapters = [...selectedNovel.chapters];
  const existingCount = existingChapters.length;

  // Chapter number -> index in existingChapters, for chapters whose title
  // carries a number. Lets the skip logic below hop over chapters already
  // in the library by number instead of requesting each one from the site.
  const localByNumber = new Map<number, number>();
  existingChapters.forEach((c, i) => {
    const n = extractChapterNumber(c.title);
    if (n > 0 && !localByNumber.has(n)) localByNumber.set(n, i);
  });
  // A novel whose saved chapter links point at a different host than its
  // current source (after "Change Source"). Those links cannot be used to
  // resume or to match chapters, so chapters are matched by chapter number.
  const currentHost = hostOf(selectedNovel.sourceUrl);
  const crossSource =
    currentHost !== "" &&
    existingChapters.some((c) => !!c.url && hostOf(c.url) !== currentHost);
  const startCh = Math.max(
    1,
    parseInt(startChStr) || getNextStartChapter(selectedNovel),
  );
  const parsedMaxCh = parseInt(maxChStr) || DEFAULT_MAX_CHAPTERS;
  const maxCh = Math.min(parsedMaxCh, CHAPTER_LIMIT_MAX);

  stopRef.current = false;
  resetHalt();
  setIsUpdating(true);
  clearLogs();
  setProgress(0);
  setProgressLabel("");
  setElapsedTime("00:00:00");
  startTimer();

  try {
    let domain = "";
    try {
      domain = new URL(selectedNovel.sourceUrl).hostname;
    } catch {
      domain = "Unknown";
    }

    let metaUrl = selectedNovel.sourceUrl;
    const sourceIsChapterUrl = NOVEL_SOURCE_CHAPTER_PATTERN.test(
      selectedNovel.sourceUrl,
    );
    if (sourceIsChapterUrl) {
      const chapterIndex = selectedNovel.sourceUrl.search(
        NOVEL_SOURCE_CHAPTER_PATTERN,
      );
      metaUrl = selectedNovel.sourceUrl
        .slice(0, chapterIndex)
        .replace(/\/$/, "");
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`CONNECTING TO SOURCE...`, "downloading");
    addLog(`Source Domain: ${domain}`, "info");
    if (sourceIsChapterUrl) {
      addLog(
        `Chapter URL detected in saved source — using novel info page: ${metaUrl}`,
        "info",
      );
    }
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    const meta = await fetchNovelMeta(metaUrl);

    addLog(`Connection successful!`, "success");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`NOVEL INFORMATION`, "downloading");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`Title: ${meta.title}`, "success");
    addLog(`Author: ${meta.author}`, "info");
    addLog(`Current chapters in library: ${existingCount}`, "info");
    if (crossSource)
      addLog("Source changed: matching chapters by number", "info");
    if (startChStr) addLog(`Starting from chapter: ${startCh}`, "info");
    if (maxCh) addLog(`Max chapters to download: ${maxCh}`, "info");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    if (!meta.firstChapterUrl) {
      addLog("Could not find chapter links on this page", "error");
      stopTimer();
      setIsUpdating(false);
      return;
    }

    // Cover update
    let updatedCoverUrl = selectedNovel.coverUrl;
    if (meta.coverUrl) {
      addLog(`Cover found, downloading...`, "info");
      updatedCoverUrl = await downloadAndSaveCover(
        addLog,
        meta.coverUrl,
        selectedNovel.id,
      );
      addLog(`Cover updated successfully`, "success");
    }

    if (meta.author !== selectedNovel.author) {
      addLog(`Author updated: ${meta.author}`, "info");
    }

    // ========== SKIP TO START CHAPTER ==========
    let currentUrl: string | null = meta.firstChapterUrl;
    let chapterNum = 1;

    // Holds a chapter already fetched while validating a direct-skip guess,
    // so the download loop below can reuse it instead of re-fetching it.
    let prefetchedChapter: {
      url: string;
      chapterNum: number;
      data: Awaited<ReturnType<typeof fetchChapter>>;
    } | null = null;

    if (startCh > 1) {
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(`Skipping to chapter ${startCh}...`, "downloading");

      const directUrl = tryDirectSkip(meta.firstChapterUrl, startCh);
      let directSkipWorked = false;

      if (directUrl) {
        // FIX: don't trust the regex-guessed URL blindly — validate it with
        // a real fetch first. A wrong guess previously caused an error that
        // aborted the whole update instead of falling back to crawling.
        try {
          const testData = await fetchChapter(directUrl, startCh);

          // Extra safety net: some sites (e.g. WordPress-based themes)
          // return a "soft 404" — HTTP 200 with a "Page Not Found" body —
          // for a guessed URL that doesn't correspond to a real chapter.
          // That doesn't throw, so without this check a bad guess could
          // silently get saved as a real chapter (e.g. titled just "404").
          const looksLikeSoft404 =
            /^\s*404\s*$/i.test(testData.title) ||
            /page not found|not found|does not exist/i.test(testData.title);

          if (looksLikeSoft404) {
            addLog(
              `Direct skip guess landed on a "Page Not Found" page, falling back to crawl...`,
              "warning",
            );
          } else {
            addLog(
              `Direct skip to chapter ${startCh} (URL pattern matched)`,
              "success",
            );
            currentUrl = directUrl;
            chapterNum = startCh;
            directSkipWorked = true;
            prefetchedChapter = {
              url: directUrl,
              chapterNum: startCh,
              data: testData,
            };
          }
        } catch {
          addLog(
            `Direct skip guess was invalid, falling back to crawl...`,
            "warning",
          );
        }
      }

      if (!directSkipWorked) {
        currentUrl = meta.firstChapterUrl;
        chapterNum = 1;
        addLog(
          `Crawling to chapter ${startCh} (no URL pattern detected)...`,
          "warning",
        );

        // Walk the chapter numbers downward from startCh - 1: the first one
        // the library already has is where the crawl can resume. Everything
        // before it is already local, so it needs no requests at all. Only
        // that one chapter is fetched (to read its "next" link); any
        // numbers missing between it and startCh are crawled as before.
        for (let n = startCh - 1; n >= 1; n--) {
          const localIdx = localByNumber.get(n);
          if (
            !crossSource &&
            localIdx !== undefined &&
            existingChapters[localIdx].url
          ) {
            currentUrl = existingChapters[localIdx].url;
            chapterNum = n;
            addLog(
              `Chapters 1–${n} already in library — resuming crawl from chapter ${n}`,
              "info",
            );
            break;
          }
        }

        let skippedCount = 0;
        let lastLoggedMilestone = 0;
        const totalToSkip = startCh - chapterNum;

        while (currentUrl && chapterNum < startCh && !stopRef.current) {
          try {
            const { nextUrl } = await getChapterMetadata(
              currentUrl,
              chapterNum,
            );
            currentUrl = nextUrl;
            chapterNum++;
            skippedCount++;

            const percent = Math.floor((skippedCount / totalToSkip) * 100);
            const nextMilestone = lastLoggedMilestone + 20;
            if (percent >= nextMilestone && nextMilestone <= 80) {
              addLog(
                `Skipping... ${nextMilestone}% (${skippedCount}/${totalToSkip})`,
                "warning",
              );
              lastLoggedMilestone = nextMilestone;
            }
          } catch {
            addLog(
              `Failed to skip chapter ${chapterNum}, retrying...`,
              "warning",
            );
            try {
              const { nextUrl } = await getChapterMetadata(
                currentUrl!,
                chapterNum,
              );
              currentUrl = nextUrl;
              chapterNum++;
              skippedCount++;
            } catch {
              addLog(`Skip aborted at chapter ${chapterNum}`, "error");
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 35));
          if (skippedCount % 20 === 0)
            await new Promise((r) => setTimeout(r, 0));
        }

        if (skippedCount > 0) {
          addLog(
            `Skipped ${skippedCount} chapters, ready at chapter ${startCh}`,
            "success",
          );
        }

        if (!currentUrl) {
          addLog(
            `Could not reach chapter ${startCh}. Update aborted.`,
            "error",
          );
          stopTimer();
          setIsUpdating(false);
          return;
        }
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    }

    addLog(`Starting download from chapter ${chapterNum}...`, "downloading");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    // ========== DOWNLOAD NEW CHAPTERS ==========
    const newChapters: (Chapter & {
      chapterNumber: number;
      content?: string;
    })[] = [];
    const gapFills: {
      url: string;
      content: string;
      title: string;
      num: number;
    }[] = [];
    let downloaded = 0;
    let gapFillCount = 0;
    let consecutiveErrors = 0;

    // Hard iteration ceiling so a broken nextUrl chain (site pagination bug,
    // redirect loop, etc.) can never spin forever without ever incrementing
    // `downloaded` — which is the only thing the maxCh check below looks at.
    const ITERATION_CEILING = maxCh * 5 + 50;
    let iterations = 0;

    // Tracks every URL actually fetched in this run (new chapters AND
    // re-downloads). A repeat here means the site's nextUrl chain has
    // looped — the earlier check only looked at newChapters, which missed
    // loops that happened entirely within the existsInLibrary/re-download
    // path (e.g. AllNovel: chapter 177's page has a broken "next" link
    // that resolves back to itself, so every "re-download" after it kept
    // re-fetching chapter 177's content under increasing chapter labels).
    const visitedThisRun = new Set<string>();

    while (currentUrl && !stopRef.current) {
      if (downloaded >= maxCh) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(`Reached max chapter limit (${maxCh})`, "success");
        break;
      }

      iterations++;
      if (iterations > ITERATION_CEILING) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(
          `Stopped: exceeded ${ITERATION_CEILING} chapter iterations without reaching the max chapter limit (${maxCh}). ` +
            `The source is likely stuck in a navigation loop. Check the scraper's nextUrl extraction for this site.`,
          "error",
        );
        break;
      }

      setProgressLabel(`Chapter ${chapterNum}`);
      if (maxCh) setProgress((downloaded / maxCh) * 100);

      // Check if chapter exists in library (by URL)
      const localIdxForNum = crossSource
        ? localByNumber.get(chapterNum)
        : undefined;
      const existsInLibrary = crossSource
        ? localIdxForNum !== undefined
        : chapterExists(currentUrl, existingChapters);
      const existsInNew = chapterExists(currentUrl, newChapters);

      // A URL repeating at all in this run — whether it's a duplicate "new"
      // chapter or a gap-fill — means the site's "next chapter" link has
      // looped back on itself. Treat that as a hard stop instead of an
      // infinite SKIPPED loop (which also silently blocked the maxCh limit
      // from ever being reached, since `downloaded` never advanced).
      if (visitedThisRun.has(currentUrl)) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(
          `Stopped: Chapter ${chapterNum}'s URL was already fetched earlier in this run. ` +
            `The source's "next chapter" link is looping back on itself instead of moving forward.`,
          "error",
        );
        break;
      }
      visitedThisRun.add(currentUrl);

      let shouldDownload = false;
      let isGapFill = false;

      if (existsInNew) {
        // Duplicate URL within this same run — content was just fetched
        // a moment ago, guaranteed present. Just move on.
        addLog(
          `SKIPPED: Chapter ${chapterNum} already fetched this run`,
          "warning",
        );
        try {
          const { nextUrl } = await getChapterMetadata(currentUrl, chapterNum);
          currentUrl = nextUrl;
          chapterNum++;
          continue;
        } catch {
          addLog(
            `Failed to get next chapter URL for ${chapterNum}, aborting skip`,
            "error",
          );
          break;
        }
      } else if (existsInLibrary) {
        // Listed in the novel's metadata — but metadata alone doesn't prove
        // the chapter file actually made it to disk (an interrupted write,
        // a crash between the metadata save and the content save, etc. can
        // leave a "ghost" entry). Check the real per-chapter file before
        // trusting it, instead of either (a) blindly skipping forever, or
        // (b) re-downloading every chapter on every run regardless of
        // whether it's actually there.
        const idx = crossSource
          ? (localIdxForNum ?? -1)
          : existingChapters.findIndex((c) => c.url === currentUrl);
        const onDisk =
          idx >= 0 ? await loadChapterContent(selectedNovel.id, idx) : null;
        const hasRealContent =
          !!onDisk?.content && onDisk.content.trim().length > 0;

        if (hasRealContent) {
          addLog(
            `SKIPPED: Chapter ${chapterNum} already in library`,
            "warning",
          );

          // If the next chapter number is also in the library with real
          // content on disk, hop straight to it using its saved URL — no
          // request. Only when the next one is missing locally do we fetch
          // this chapter to read its "next" link.
          const nextLocalIdx = crossSource
            ? undefined
            : localByNumber.get(chapterNum + 1);
          if (nextLocalIdx !== undefined) {
            const nextOnDisk = await loadChapterContent(
              selectedNovel.id,
              nextLocalIdx,
            );
            if (
              existingChapters[nextLocalIdx].url &&
              !!nextOnDisk?.content &&
              nextOnDisk.content.trim().length > 0
            ) {
              currentUrl = existingChapters[nextLocalIdx].url;
              chapterNum++;
              continue;
            }
          }

          try {
            const { nextUrl } = await getChapterMetadata(
              currentUrl,
              chapterNum,
            );
            currentUrl = nextUrl;
            chapterNum++;
            continue;
          } catch {
            addLog(
              `Failed to get next chapter URL for ${chapterNum}, aborting skip`,
              "error",
            );
            break;
          }
        } else {
          addLog(
            `Chapter ${chapterNum} is listed but its content file is missing — filling gap...`,
            "warning",
          );
          shouldDownload = true;
          isGapFill = true;
        }
      } else {
        // Chapter does not exist → download as new
        shouldDownload = true;
      }

      if (shouldDownload) {
        try {
          // Reuse the validated prefetch from the direct-skip step if it
          // matches exactly what we're about to fetch, avoiding a duplicate
          // network request for the same chapter.
          let data: Awaited<ReturnType<typeof fetchChapter>>;
          if (
            prefetchedChapter &&
            prefetchedChapter.url === currentUrl &&
            prefetchedChapter.chapterNum === chapterNum
          ) {
            addLog(
              `Using validated Chapter ${chapterNum} (already fetched)`,
              "downloading",
            );
            data = prefetchedChapter.data;
          } else {
            addLog(`Downloading Chapter ${chapterNum}...`, "downloading");
            data = await fetchChapter(currentUrl, chapterNum);
          }
          // Prefetch cache is single-use — clear it after this iteration.
          prefetchedChapter = null;

          const chapterNumber = extractChapterNumber(data.title);
          if (isGapFill) {
            gapFills.push({
              url: currentUrl,
              content: data.content,
              title: data.title,
              num: chapterNumber,
            });
            gapFillCount++;
            addLog(
              `Gap filled: ${data.title} (Chapter ${chapterNumber})`,
              "success",
            );
          } else {
            newChapters.push({
              title: data.title,
              url: currentUrl,
              content: data.content,
              chapterNumber,
            });
            downloaded++;
            addLog(
              `Saved: ${data.title} (Chapter ${chapterNumber})`,
              "success",
            );
          }

          consecutiveErrors = 0;
          // Update progress label with total downloaded (new + re-downloaded)
          if (downloaded % 5 === 0) {
            addLog(
              `Saved ${downloaded} new chapter${downloaded !== 1 ? "s" : ""} so far`,
              "success",
            );
          }

          if (!data.nextUrl) {
            addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
            addLog(`No more chapters found.`, "info");
            break;
          }
          currentUrl = data.nextUrl;
          chapterNum++;
        } catch (err: any) {
          if (isHalted()) break;
          consecutiveErrors++;
          addLog(
            `Failed to download Chapter ${chapterNum}: ${err.message}`,
            "error",
          );

          if (consecutiveErrors >= 3) {
            addLog(`Too many consecutive errors, stopping update.`, "warning");
            break;
          }

          try {
            const { nextUrl } = await getChapterMetadata(
              currentUrl,
              chapterNum,
            );
            if (nextUrl) {
              currentUrl = nextUrl;
              chapterNum++;
            } else {
              break;
            }
          } catch {
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // ========== FINALIZE & SORT ==========
    if (
      downloaded > 0 ||
      gapFillCount > 0 ||
      updatedCoverUrl !== selectedNovel.coverUrl
    ) {
      // Build final chapters list with content for those that have been updated
      const allChapters: (Chapter & { content?: string })[] = [
        ...existingChapters,
      ];

      // Position of each existing chapter file before the re-sort below.
      const preSortIndexByUrl = new Map<string, number>(
        existingChapters.map((c, i) => [c.url, i]),
      );

      // Add new chapters
      newChapters.forEach((newCh) => {
        if (!chapterExists(newCh.url, allChapters)) {
          const { chapterNumber, ...chapterData } = newCh;
          allChapters.push(chapterData);
        }
      });

      // Fill in gap chapters at their existing position (by URL) rather
      // than appending — they were already listed, just missing content.
      gapFills.forEach(({ url, content, title, num }) => {
        const existing =
          allChapters.find((c) => c.url === url) ??
          (crossSource && num > 0
            ? allChapters.find((c) => extractChapterNumber(c.title) === num)
            : undefined);
        if (existing) {
          existing.content = content;
          if (title) existing.title = title;
        }
      });

      addLog(
        `Sorting ${allChapters.length} chapters by chapter number...`,
        "info",
      );

      // Reading order. Unnumbered chapters keep their place after the number
      // before them, instead of moving to the front. Phase 0 moves each
      // chapter file to match the new positions.
      allChapters.splice(0, allChapters.length, ...orderChapters(allChapters));

      const validNums = allChapters
        .map((c) => extractChapterNumber(c.title))
        .filter((n) => n > 0);
      if (validNums.length > 0) {
        const minCh = Math.min(...validNums);
        const maxChNum = Math.max(...validNums);
        const missingCount = allChapters.length - validNums.length;
        addLog(
          `Chapters sorted: ${minCh} → ${maxChNum} (${allChapters.length} total${missingCount > 0 ? `, ${missingCount} untitled` : ""})`,
          "success",
        );
      }

      // Files are addressed by position in novel.chapters. Move any existing
      // chapter file that the re-sort relocated, so every position still
      // maps to the same chapter. Runs on every update, because the sorted
      // list is persisted below whether or not anything was downloaded.
      const chapterFileMoves: ChapterFileMove[] = [];
      allChapters.forEach((c, newIdx) => {
        const oldIdx = preSortIndexByUrl.get(c.url);
        if (oldIdx !== undefined) {
          chapterFileMoves.push({ from: oldIdx, to: newIdx });
        }
      });
      await applyChapterFileMoves(selectedNovel.id, chapterFileMoves);

      // Save all updated content to disk (only chapters that have `content` will be written)
      if (downloaded > 0 || gapFillCount > 0) {
        addLog(`Saving chapter content to disk...`, "info");
        await saveAllChaptersToFile(selectedNovel.id, allChapters);
      }

      // Strip content before persisting the lightweight chapters metadata
      const chaptersMetaOnly: Chapter[] = allChapters.map(
        ({ content, ...rest }) => rest,
      );

      await updateNovel(selectedNovel.id, {
        chapters: chaptersMetaOnly,
        coverUrl: updatedCoverUrl,
        author: meta.author,
        synopsis: meta.synopsis,
        sourceUrl: metaUrl,
      });

      if (downloaded > 0) {
        addLog(`Novel updated with ${downloaded} new chapters!`, "success");
      }
      if (gapFillCount > 0) {
        addLog(
          `Filled ${gapFillCount} chapter${gapFillCount !== 1 ? "s" : ""} with missing content`,
          "success",
        );
      }
    } else if (sourceIsChapterUrl) {
      // No new chapters, but fix stored sourceUrl
      await updateNovel(selectedNovel.id, { sourceUrl: metaUrl });
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    if (stopRef.current) {
      addLog(`Update halted by user.`, "warning");
      addLog(`Downloaded ${downloaded} new chapters before stop.`, "info");
    } else if (downloaded === 0 && gapFillCount === 0) {
      addLog(`UPDATE COMPLETE!`, "success");
      addLog(
        `No new chapters and no missing content found. Novel is up to date!`,
        "success",
      );
    } else {
      addLog(`UPDATE COMPLETE!`, "success");
      if (downloaded > 0)
        addLog(`New chapters added: ${downloaded}`, "success");
      if (gapFillCount > 0)
        addLog(
          `Chapters with missing content filled: ${gapFillCount}`,
          "success",
        );
      addLog(`Novel updated in your library!`, "success");
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    setProgress(100);
  } catch (e: any) {
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
    if (isHalted()) addLog(`Update halted by user.`, "warning");
    else addLog(`ERROR: ${e.message || "Update failed"}`, "error");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
  } finally {
    endPausedSiteException();
    setIsUpdating(false);
    stopTimer();
  }
}
