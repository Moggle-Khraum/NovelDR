import type { MutableRefObject } from "react";
import * as FileSystem from "expo-file-system/legacy";

import { Novel, Chapter } from "@/context/LibraryContext";
import { fetchNovelMeta, fetchChapter } from "@/hooks/useApi";
import { tryDirectSkip, extractChapterNumber } from "@/lib/addHelpers";
import { CHAPTER_LIMIT_MAX } from "@/hooks/useChapterLimiter";
import { getCookieHeader } from "@/hooks/scrapers/shared/cookies";
import { hasProtectedCover } from "@/hooks/scrapers/shared/webviewSites";
import { isHalted, resetHalt } from "@/hooks/scrapers/shared/haltControl";
import { endPausedSiteException } from "@/hooks/scrapers/shared/lowMemoryState";
import { saveCoverViaWebView } from "@/hooks/scrapers/shared/coverFetch";

export type LogEntry = {
  id: string;
  text: string;
  type: "info" | "downloading" | "success" | "error" | "warning";
};

type LogFn = (text: string, type?: LogEntry["type"]) => void;

// Fallback used when Max Chapters is left blank (mirrors Start Chapter's
// fallback to 1).
export const DEFAULT_MAX_CHAPTERS = 30;

export type AddEngineInput = {
  trimmedUrl: string;
  startChStr: string;
  maxChStr: string;
  novels: Novel[];
};

// Everything the engine needs from the screen. The engine holds no React
// state of its own; it reports through these callbacks.
export type AddEngineUi = {
  stopRef: MutableRefObject<boolean>;
  addLog: LogFn;
  clearLogs: () => void;
  setIsDownloading: (value: boolean) => void;
  setProgress: (value: number) => void;
  setProgressLabel: (value: string) => void;
  startTimer: () => void;
  stopTimer: () => void;
  addNovel: (novel: Novel) => Promise<void>;
  onDuplicate: (title: string, chapterCount: number) => void;
};

export const fetchChapterWithRetries = async (
  log: LogFn,
  fetchUrl: string,
  num: number,
  retries = 3,
): Promise<Awaited<ReturnType<typeof fetchChapter>>> => {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchChapter(fetchUrl, num);
    } catch (err) {
      lastErr = err;
      if (isHalted()) throw err;
      if (attempt < retries) {
        log(
          `Chapter ${num} failed (attempt ${attempt}/${retries}), retrying...`,
          "warning",
        );
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastErr;
};

export const getChapterMetadata = async (
  url: string,
  chapterNum: number,
): Promise<{ nextUrl: string | null; title: string }> => {
  const data = await fetchChapter(url, chapterNum);
  return { nextUrl: data.nextUrl || null, title: data.title };
};

export const downloadAndSaveCover = async (
  log: LogFn,
  coverUrl: string,
  novelId: string,
): Promise<string> => {
  if (!coverUrl) {
    log("Cover: scraper returned no image URL", "warning");
    return "";
  }
  const coverDir = `${FileSystem.documentDirectory}covers/`;
  const coverPath = `${coverDir}${novelId}.jpg`;
  // Last resort: fetch the image from inside a WebView that passed the
  // Cloudflare challenge. If that fails too, the placeholder is used.
  const viaWebView = async (reason: string): Promise<string> => {
    log(`Cover: ${reason}, fetching through WebView`, "info");
    try {
      const uri = await saveCoverViaWebView(coverUrl, coverPath);
      log("Cover image saved through WebView", "success");
      return uri;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Cover WebView fetch failed (${msg}), using placeholder`, "warning");
      return "";
    }
  };
  if (hasProtectedCover(coverUrl)) {
    return viaWebView("protected site");
  }
  log(`Cover URL: ${coverUrl}`, "info");
  // Cloudflare's clearance cookie from the WebView is required for some
  // image hosts (e.g. NovelasLigera), so send the stored cookies with it.
  const cookieHeader = await getCookieHeader(coverUrl);
  log(
    `Cover: sending ${cookieHeader ? cookieHeader.split(";").length : 0} cookie(s)`,
    "info",
  );
  try {
    const dirInfo = await FileSystem.getInfoAsync(coverDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(coverDir, { intermediates: true });
    }
    // Some hosts (fanmtl.com) reject image requests without a browser UA
    // and a same-site Referer. downloadAsync doesn't throw on 403/404 - it
    // saves the error body as the .jpg - so check the status ourselves.
    let referer = "";
    try {
      referer = `${new URL(coverUrl).origin}/`;
    } catch {}
    const downloadResult = await FileSystem.downloadAsync(coverUrl, coverPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    const contentType = String(
      downloadResult.headers?.["Content-Type"] ??
        downloadResult.headers?.["content-type"] ??
        "",
    );
    log(
      `Cover response: HTTP ${downloadResult.status}, type ${contentType || "none"}`,
      "info",
    );
    if (downloadResult.status !== 200) {
      await FileSystem.deleteAsync(coverPath, { idempotent: true });
      throw new Error(`HTTP ${downloadResult.status}`);
    }
    // A 200 can still be an HTML block page or a hotlink placeholder.
    if (contentType && !/^image\//i.test(contentType)) {
      await FileSystem.deleteAsync(coverPath, { idempotent: true });
      throw new Error(`not an image (${contentType})`);
    }
    log(`Cover image saved locally`, "success");
    return downloadResult.uri;
  } catch (err) {
    console.warn("Failed to download cover:", err);
    const reason = err instanceof Error ? err.message : String(err);
    return viaWebView(`download failed (${reason})`);
  }
};

export async function runAddDownload(
  input: AddEngineInput,
  ui: AddEngineUi,
): Promise<void> {
  const { trimmedUrl, startChStr, maxChStr, novels } = input;
  const {
    stopRef,
    addLog,
    clearLogs,
    setIsDownloading,
    setProgress,
    setProgressLabel,
    startTimer,
    stopTimer,
    addNovel,
    onDuplicate,
  } = ui;
  const startCh = Math.max(1, parseInt(startChStr) || 1);
  const parsedMaxCh = parseInt(maxChStr) || DEFAULT_MAX_CHAPTERS;
  const maxCh = Math.min(parsedMaxCh, CHAPTER_LIMIT_MAX);

  // ── Detect if a chapter URL was pasted directly ──────────────────────────
  const chapterUrlPattern = /\/chapter[-/](\d+)/i;
  const chapterUrlMatch = trimmedUrl.match(chapterUrlPattern);
  const isChapterUrl = !!chapterUrlMatch;

  let metaUrl = trimmedUrl;
  let directChapterUrl: string | null = null;
  let directChapterNum = startCh;

  if (isChapterUrl) {
    const chapterIndex = trimmedUrl.search(chapterUrlPattern);
    metaUrl = trimmedUrl.slice(0, chapterIndex).replace(/\/$/, "");
    directChapterUrl = trimmedUrl;
    directChapterNum = parseInt(chapterUrlMatch![1]) || startCh;
    addLog(
      `Chapter URL detected — fetching novel info from: ${metaUrl}`,
      "info",
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  stopRef.current = false;
  resetHalt();
  setIsDownloading(true);
  clearLogs();
  setProgress(0);
  startTimer();

  try {
    const meta = await fetchNovelMeta(metaUrl);

    const existingNovel = novels.find(
      (n) => n.title.toLowerCase() === meta.title.toLowerCase(),
    );

    if (existingNovel) {
      onDuplicate(meta.title, existingNovel.chapters.length);
      setIsDownloading(false);
      return;
    }

    let domain = "";
    try {
      domain = new URL(trimmedUrl).hostname;
    } catch {
      domain = "Unknown";
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`CONNECTING TO SOURCE...`, "downloading");
    addLog(`Source Domain: ${domain}`, "info");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`Connection successful!`, "success");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`NOVEL INFORMATION`, "downloading");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    addLog(`Title: ${meta.title}`, "success");
    addLog(`Author: ${meta.author}`, "info");

    if (meta.synopsis && meta.synopsis !== "No summary available.") {
      const shortSynopsis =
        meta.synopsis.length > 100
          ? meta.synopsis.substring(0, 100) + "..."
          : meta.synopsis;
      addLog(`Synopsis: ${shortSynopsis}`, "info");
    }

    if (meta.coverUrl) addLog(`Cover found, downloading...`, "info");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    if (meta.debugInfo && meta.debugInfo.length > 0) {
      addLog(`DEBUG INFO`, "downloading");
      meta.debugInfo.forEach((line) => addLog(line, "info"));
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    }

    if (!meta.firstChapterUrl) {
      addLog("Could not find chapter links on this page", "error");
      setIsDownloading(false);
      return;
    }

    addLog(`First chapter URL found`, "success");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    const safeId =
      meta.title
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "") +
      "-" +
      Date.now();

    let localCoverUrl = "";
    if (meta.coverUrl) {
      localCoverUrl = await downloadAndSaveCover(addLog, meta.coverUrl, safeId);
    }

    // Base novel metadata, built once up front so checkpoint saves during
    // the download loop and the final save both write the exact same
    // novel record — only `chapters` differs between calls.
    const dateAdded = Date.now();
    const novelBase: Omit<Novel, "chapters"> = {
      id: safeId,
      title: meta.title,
      author: meta.author,
      synopsis: meta.synopsis,
      coverUrl: localCoverUrl,
      sourceUrl: metaUrl,
      dateAdded,
      status: "unread",
    };

    // ── If a chapter URL was pasted, skip directly to it ─────────────────
    let currentUrl: string | null = directChapterUrl ?? meta.firstChapterUrl;
    let chapterNum = directChapterUrl ? directChapterNum : 1;

    if (directChapterUrl) {
      addLog(`Starting directly from chapter ${directChapterNum}`, "success");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    }

    // ========== SKIP CHAPTERS BEFORE START CHAPTER ==========
    // Holds a chapter we already fetched during direct-skip validation, so
    // the download loop below can reuse it instead of re-fetching it.
    let prefetchedChapter: {
      url: string;
      chapterNum: number;
      data: Awaited<ReturnType<typeof fetchChapter>>;
    } | null = null;

    if (!directChapterUrl && startCh > 1) {
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(`Skipping to chapter ${startCh}...`, "downloading");

      const directUrl = tryDirectSkip(meta.firstChapterUrl!, startCh);
      let directSkipWorked = false;

      if (directUrl) {
        // FIX: Don't trust the regex-guessed URL blindly — validate it with
        // a real fetch first. A wrong guess previously caused a 403 that
        // aborted the whole download instead of falling back to crawling.
        try {
          const testData = await fetchChapter(directUrl, startCh);
          addLog(
            `Direct skip to chapter ${startCh} (URL pattern matched)`,
            "success",
          );
          currentUrl = directUrl;
          chapterNum = startCh;
          directSkipWorked = true;

          // OPTIMIZATION: cache the validated fetch so the download loop
          // doesn't request the exact same URL a second time.
          prefetchedChapter = {
            url: directUrl,
            chapterNum: startCh,
            data: testData,
          };
        } catch {
          addLog(
            `Direct skip guess was invalid, falling back to crawl...`,
            "warning",
          );
        }
      }

      if (!directSkipWorked) {
        addLog(
          `Crawling to chapter ${startCh} (no reliable URL pattern)...`,
          "warning",
        );

        // Reset in case a failed direct-skip attempt left these mutated.
        currentUrl = meta.firstChapterUrl!;
        chapterNum = 1;

        let skippedCount = 0;
        let lastLoggedMilestone = 0;
        const totalToSkip = startCh - 1;

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
        }

        if (skippedCount > 0) {
          addLog(
            `Skipped ${skippedCount} chapters, ready at chapter ${startCh}`,
            "success",
          );
        }

        if (!currentUrl) {
          addLog(
            `Could not reach chapter ${startCh}. Download aborted.`,
            "error",
          );
          stopTimer();
          setIsDownloading(false);
          return;
        }
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    }

    // ========== DOWNLOAD CHAPTERS ==========
    const newChapters: (Chapter & { chapterNumber: number })[] = [];
    const failedChapters: { chapterNum: number; url: string }[] = [];
    let downloaded = 0;
    let lastCheckpointCount = 0; // how many of newChapters are already flushed to disk

    // Same cycle-detection this screen was missing: since a brand-new add
    // has nothing on disk to compare against, a broken nextUrl chain used
    // to just re-download the same chapter over and over, quietly burning
    // through maxCh on duplicates instead of failing loudly.
    const visitedThisRun = new Set<string>();
    const ITERATION_CEILING = maxCh * 5 + 50;
    let iterations = 0;

    addLog(`Starting from chapter ${startCh}...`, "downloading");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    while (currentUrl && !stopRef.current) {
      if (downloaded >= maxCh) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(`Reached max chapter limit (${maxCh})`, "success");
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
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

      if (visitedThisRun.has(currentUrl)) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(
          `Stopped: Chapter ${chapterNum}'s URL was already downloaded earlier in this run. ` +
            `The source's "next chapter" link is looping back on itself instead of moving forward.`,
          "error",
        );
        break;
      }
      visitedThisRun.add(currentUrl);

      setProgressLabel(`Chapter ${chapterNum}`);
      if (maxCh) setProgress((downloaded / maxCh) * 100);

      try {
        // OPTIMIZATION: reuse the validated prefetch from the direct-skip
        // step if it matches exactly what we're about to fetch, avoiding a
        // duplicate network request for the same chapter.
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
          data = await fetchChapterWithRetries(addLog, currentUrl, chapterNum);
        }
        // Prefetch cache is single-use — clear it after this iteration.
        prefetchedChapter = null;

        const chapterNumber = extractChapterNumber(data.title);

        newChapters.push({
          title: data.title,
          url: currentUrl,
          content: data.content,
          chapterNumber,
        });

        downloaded++;

        // LNW-only: show connection diagnostics and scraper stats
        if (data.scraperInfo) {
          const si = data.scraperInfo;
          const selectorLabel =
            si.selector === "chapterText"
              ? "🎯 #chapterText"
              : si.selector === "chapter-text"
                ? "🔄 .chapter-text"
                : "⚠️ generic fallback";
          const methodLabel =
            si.fetchMethod === "fetch-proxy"
              ? "🔀 fetch (proxy)"
              : "🌐 fetch (direct)";
          const injectedLabel = si.jsInjected
            ? "⚠️ JS injection detected"
            : "✅ Clean HTML";
          const idCountLabel =
            si.chapterTextCount !== 1
              ? `  ⚠️ #chapterText x${si.chapterTextCount}`
              : "";
          addLog(`[LNW] ── Connection ──────────────────`, "info");
          addLog(`[LNW] Method : ${methodLabel}`, "info");
          addLog(
            `[LNW] Status : HTTP ${si.httpStatus}  ${si.contentType}`,
            "info",
          );
          addLog(
            `[LNW] Server : ${injectedLabel}${idCountLabel}`,
            si.jsInjected ? "warning" : "info",
          );
          addLog(`[LNW] ── Extraction ─────────────────`, "info");
          addLog(
            `[LNW] Selector  : ${selectorLabel}`,
            si.selector === "generic-fallback" ? "warning" : "info",
          );
          addLog(
            `[LNW] HTML size : ${Math.round(si.htmlLength / 1024)}kb  <p> tags: ${si.pTagCount}`,
            "info",
          );
          addLog(
            `[LNW] Paragraphs: raw ${si.rawCount} → filtered ${si.filteredCount}`,
            "info",
          );
          addLog(`[LNW] ─────────────────────────────`, "info");
        }

        if (downloaded % 10 === 0) {
          addLog(
            `Saved: ${data.title} (Chapter ${chapterNumber}) [${downloaded} chapters so far]`,
            "success",
          );

          // ── Checkpoint: flush what we have to disk every 10 chapters ──
          // so a crash mid-download only loses the current batch, not the
          // whole run. addNovel() dedupes by URL and appends, so calling
          // it repeatedly for the same safeId is safe.
          try {
            const checkpointBatch = newChapters
              .slice(lastCheckpointCount)
              .map(({ chapterNumber, ...ch }) => ch);
            await addNovel({ ...novelBase, chapters: checkpointBatch });
            lastCheckpointCount = newChapters.length;
            addLog(
              `Checkpoint: ${downloaded} chapters written to disk`,
              "info",
            );
          } catch (checkpointErr: any) {
            addLog(
              `Checkpoint save failed: ${checkpointErr.message}`,
              "warning",
            );
          }
        } else {
          addLog(`Saved: ${data.title} (Chapter ${chapterNumber})`, "success");
        }

        if (maxCh) setProgress((downloaded / maxCh) * 100);

        if (!data.nextUrl) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(`No more chapters found.`, "info");
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          break;
        }
        currentUrl = data.nextUrl;
        chapterNum++;
      } catch (err: any) {
        if (isHalted()) break;
        addLog(
          `Chapter ${chapterNum} failed after 3 attempts, skipping for now: ${err.message}`,
          "warning",
        );
        failedChapters.push({ chapterNum, url: currentUrl });

        // Try to guess the next chapter's URL structurally so the run can
        // keep going even without this chapter's nextUrl. If we can't,
        // there's no way to know where to continue from — stop here.
        const guessedNextUrl = meta.firstChapterUrl
          ? tryDirectSkip(meta.firstChapterUrl, chapterNum + 1)
          : null;

        if (!guessedNextUrl) {
          addLog(
            `Can't determine the next chapter's URL — stopping here. ` +
              `${failedChapters.length} chapter(s) were skipped and will be retried before finishing.`,
            "error",
          );
          break;
        }
        currentUrl = guessedNextUrl;
        chapterNum++;
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    // ========== RETRY SKIPPED CHAPTERS ==========
    if (failedChapters.length > 0 && !stopRef.current) {
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(
        `Retrying ${failedChapters.length} skipped chapter(s)...`,
        "downloading",
      );
      const stillFailed: typeof failedChapters = [];
      for (const fc of failedChapters) {
        if (stopRef.current) break;
        try {
          const data = await fetchChapterWithRetries(
            addLog,
            fc.url,
            fc.chapterNum,
          );
          const chapterNumber = extractChapterNumber(data.title);
          newChapters.push({
            title: data.title,
            url: fc.url,
            content: data.content,
            chapterNumber,
          });
          downloaded++;
          addLog(
            `Recovered Chapter ${fc.chapterNum}: ${data.title}`,
            "success",
          );
        } catch (err: any) {
          stillFailed.push(fc);
          addLog(
            `Chapter ${fc.chapterNum} still failed after retries — giving up on it: ${err.message}`,
            "error",
          );
        }
      }
      if (stillFailed.length > 0) {
        addLog(
          `${stillFailed.length} chapter(s) could not be downloaded and were left out.`,
          "warning",
        );
      } else {
        addLog(`All previously skipped chapters recovered.`, "success");
      }
    }

    // ========== SORT & FINALIZE ==========
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    // Chapters already flushed to disk by a checkpoint are on disk in
    // download order (file index N matches array position N). Re-sorting
    // the whole list here would desync that mapping, so once checkpointing
    // has started we only sort the log summary, not the array itself —
    // downloads already arrive in ascending order in the vast majority of
    // cases, so this is a cosmetic difference in the rare edge case where
    // a source's nextUrl chain isn't monotonic.
    const alreadyCheckpointed = lastCheckpointCount > 0;
    if (!alreadyCheckpointed) {
      addLog(
        `Sorting ${newChapters.length} chapters by chapter number...`,
        "info",
      );
      newChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
    }

    if (newChapters.length > 0) {
      const validNums = newChapters
        .map((c) => c.chapterNumber)
        .filter((n) => n > 0);
      if (validNums.length > 0) {
        const minCh = Math.min(...validNums);
        const maxChNum = Math.max(...validNums);
        const missing = newChapters.length - validNums.length;
        addLog(
          `Chapters ${alreadyCheckpointed ? "range" : "sorted"}: ${minCh} → ${maxChNum} (${newChapters.length} total${missing > 0 ? `, ${missing} untitled` : ""})`,
          "success",
        );
      }
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    if (stopRef.current) {
      addLog(`Download halted by user.`, "warning");
      addLog(`Downloaded ${downloaded} chapters before stop.`, "info");
    } else {
      addLog(`DOWNLOAD COMPLETE!`, "success");
      addLog(`Total chapters added: ${downloaded}`, "success");
      if (downloaded > 0) addLog(`Novel saved to your library`, "success");
    }

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

    // Only flush what hasn't already been written by a checkpoint — addNovel
    // dedupes by URL anyway, but slicing avoids redundant disk writes.
    const remainder = newChapters
      .slice(lastCheckpointCount)
      .map(({ chapterNumber, ...ch }) => ch);

    if (remainder.length > 0 || !alreadyCheckpointed) {
      await addNovel({ ...novelBase, chapters: remainder });
    }
    setProgress(100);
  } catch (e: any) {
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
    if (isHalted()) addLog(`Download halted by user.`, "warning");
    else addLog(`ERROR: ${e.message || "Download failed"}`, "error");
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
  } finally {
    endPausedSiteException();
    setIsDownloading(false);
    stopTimer();
  }
}
