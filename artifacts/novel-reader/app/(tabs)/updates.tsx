import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import React, { useRef, useState, useMemo } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, Novel, Chapter } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchNovelMeta, fetchChapter } from "@/hooks/useApi";
import { useChapterLimiter, CHAPTER_LIMIT_MAX } from "@/hooks/useChapterLimiter";
import { ChapterLimitModal } from "@/components/ChapterLimitModal";
import Colors from "@/constants/colors";

// Detects when a saved novel's sourceUrl is actually a chapter page rather than
// the novel's info/homepage page (can happen with novels added via a pasted
// chapter link before add.tsx started normalizing sourceUrl to the homepage).
const NOVEL_SOURCE_CHAPTER_PATTERN = /\/chapter[-/](\d+)/i;

type LogEntry = {
  id: string;
  text: string;
  type: "info" | "downloading" | "success" | "error" | "warning";
};

function LogLine({ entry }: { entry: LogEntry }) {
  const { colors } = useTheme();
  const colorMap = {
    info: colors.textSecondary,
    downloading: Colors.downloading,
    success: Colors.success,
    error: Colors.error,
    warning: Colors.amber,
  };

  const getIcon = (text: string) => {
    if (text.includes("CONNECTING")) return "🔍";
    if (text.includes("Source Domain")) return "📡";
    if (text.includes("Title:")) return "📚";
    if (text.includes("Author:")) return "✍️";
    if (text.includes("Synopsis:")) return "📝";
    if (text.includes("Cover found")) return "🖼️";
    if (text.includes("Cover updated")) return "🖼️";
    if (text.includes("First chapter")) return "🔗";
    if (text.includes("UPDATING")) return "🔄";
    if (text.includes("Downloading Chapter")) return "📥";
    if (text.includes("Saved:")) return "💾";
    if (text.includes("DONE")) return "✅";
    if (text.includes("COMPLETE")) return "🎉";
    if (text.includes("ERROR")) return "❌";
    if (text.includes("SKIPPED")) return "⏭️";
    if (text.includes("SCANNING")) return "🔍";
    if (text.includes("Found")) return "📊";
    if (text.includes("limit")) return "✅";
    if (text.includes("halted")) return "⚠️";
    if (text.includes("No more chapters")) return "🏁";
    if (text.includes("━━━━")) return "";
    if (text.includes("Scanning library")) return "🔍";
    if (text.includes("Found existing")) return "📚";
    if (text.includes("Starting update")) return "🚀";
    if (text.includes("Update finished")) return "✨";
    if (text.includes("Starting from chapter")) return "📍";
    if (text.includes("Chapters sorted")) return "📚";
    if (text.includes("Chapter number")) return "🔢";
    if (text.includes("Direct skip")) return "⚡";
    if (text.includes("Chapter URL detected")) return "🔗";
    if (text.includes("re-downloading")) return "♻️";
    if (text.includes("content is missing")) return "⚠️";
    if (text.includes("has content")) return "✅";
    return "";
  };

  const icon = getIcon(entry.text);
  const displayText = icon ? `${icon} ${entry.text}` : entry.text;

  return (
    <Text style={[styles.logLine, { color: colorMap[entry.type] }]}>
      {displayText}
    </Text>
  );
}

export default function UpdatesScreen() {
  const { colors } = useTheme();
  const { novels, updateNovel, saveAllChaptersToFile } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null);
  const [startChStr, setStartChStr] = useState("");
  const [maxChStr, setMaxChStr] = useState("");
  const chapterLimiter = useChapterLimiter(maxChStr, setMaxChStr);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const [novelSearchQuery, setNovelSearchQuery] = useState("");
  const [showNovelSearch, setShowNovelSearch] = useState(false);

  const stopRef = useRef(false);
  const logScrollRef = useRef<ScrollView>(null);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const filteredNovels = useMemo(() => {
    if (!novelSearchQuery.trim()) return novels;
    const query = novelSearchQuery.toLowerCase().trim();
    return novels.filter(
      (n) =>
        n.title.toLowerCase().includes(query) ||
        n.author.toLowerCase().includes(query)
    );
  }, [novels, novelSearchQuery]);

  // ─── Log (capped at 500) ────────────────────────────────────────────────────
  const addLog = (text: string, type: LogEntry["type"] = "info") => {
    const entry: LogEntry = { id: Date.now().toString() + Math.random(), text, type };
    setLogs((prev) => [...prev.slice(-500), entry]);
    setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const clearAll = () => {
    setLogs([]);
    setProgress(0);
    setProgressLabel("");
    setElapsedTime("00:00:00");
    setStartChStr("");
    setMaxChStr("");
    chapterLimiter.resetLimiter();
    setNovelSearchQuery("");
    setShowNovelSearch(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // ─── Timer ──────────────────────────────────────────────────────────────────
  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startTimer = () => {
    startTimeRef.current = Date.now();
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(formatTime(elapsed));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // ─── Extract chapter number from title ──────────────────────────────────────
  const extractChapterNumber = (title: string): number => {
    const patterns = [
      /chapter\s+(\d+(?:\.\d+)?)/i,
      /ch\.?\s*(\d+(?:\.\d+)?)/i,
      /#(\d+(?:\.\d+)?)/,
      /(\d+)(?:st|nd|rd|th)\s+chapter/i,
      /^(\d+(?:\.\d+)?)[\s\-:]/,
      /volume\s+\d+\s+chapter\s+(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return 0;
  };

  // ─── Determine next Start Chapter from saved chapters ───────────────────────
  const getNextStartChapter = (novel: Novel): number => {
    if (novel.chapters.length === 0) return 1;
    const lastChapter = novel.chapters[novel.chapters.length - 1];
    const lastNum = extractChapterNumber(lastChapter.title);
    return lastNum > 0 ? lastNum + 1 : novel.chapters.length + 1;
  };

  // ─── Download cover ──────────────────────────────────────────────────────────
  const downloadAndSaveCover = async (coverUrl: string, novelId: string): Promise<string> => {
    if (!coverUrl) return "";
    const coverDir = `${FileSystem.documentDirectory}covers/`;
    const coverPath = `${coverDir}${novelId}.jpg`;
    try {
      const dirInfo = await FileSystem.getInfoAsync(coverDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(coverDir, { intermediates: true });
      }
      const downloadResult = await FileSystem.downloadAsync(coverUrl, coverPath);
      addLog(`Cover image saved locally`, "success");
      return downloadResult.uri;
    } catch (err) {
      console.warn("Failed to download cover:", err);
      addLog(`Cover download failed, using remote URL`, "warning");
      return coverUrl;
    }
  };

  // ─── Chapter exists check (by URL) ──────────────────────────────────────────
  const chapterExists = (url: string, existingChapters: Chapter[]): boolean =>
    existingChapters.some((c) => c.url === url);

  // ─── Chapter content file helpers (for override system) ─────────────────────
  const getChapterFilePath = (novelId: string, chapterUrl: string): string => {
    // Create a safe filename from the URL (keep it unique)
    const safeName = chapterUrl.replace(/[^a-zA-Z0-9]/g, '_');
    return `${FileSystem.documentDirectory}chapters/${novelId}/${safeName}.txt`;
  };

  const chapterHasContent = async (novelId: string, chapterUrl: string): Promise<boolean> => {
    try {
      const filePath = getChapterFilePath(novelId, chapterUrl);
      const info = await FileSystem.getInfoAsync(filePath);
      if (info.exists) {
        const content = await FileSystem.readAsStringAsync(filePath);
        return content.trim().length > 0;
      }
      return false;
    } catch {
      return false;
    }
  };

  // ─── Lightweight metadata fetch (next URL only, no content parsing) ──────────
  // FIX: this used to hand-roll its own fetch() + regex HTML scrape for the
  // "next chapter" link, which didn't know about per-site quirks (AJAX-loaded
  // chapter lists, Cloudflare proxying, LNW's #chapterText selector, etc.)
  // that fetchChapter() in useApi already handles. That mismatch is why
  // updates.tsx failed on sites that worked fine in add.tsx. Now it just
  // delegates to the same shared scraper add.tsx uses.
  const getChapterMetadata = async (
    url: string,
    chapterNum: number
  ): Promise<{ nextUrl: string | null; title: string }> => {
    const data = await fetchChapter(url, chapterNum);
    return { nextUrl: data.nextUrl || null, title: data.title };
  };

  // ─── Direct URL skip for predictable chapter URL patterns ───────────────────
  const isLightNovelWorld = (url: string): boolean =>
    url.toLowerCase().includes("lightnovelworld");

  // AsiaNovel chapter URLs (.../chapter/chapter-773154/) LOOK like they'd
  // match the generic chapter-N patterns below, but the number is an opaque
  // internal post ID, NOT a sequential chapter number — substituting the
  // target chapter number in produces a URL that doesn't exist. AsiaNovel's
  // WordPress theme returns a soft-404 (HTTP 200, "Page Not Found" body) for
  // those, so the guess doesn't even throw — it silently scrapes garbage
  // (e.g. a chapter literally titled "404") instead of failing loudly.
  const isAsianovel = (url: string): boolean =>
    url.toLowerCase().includes("asianovel.net");

  const CHAPTER_SKIP_PATTERNS: { regex: RegExp }[] = [
    { regex: /(\/chapter-)(\d+)(\.html)$/ },
    { regex: /(\/chapter-)(\d+)(\/?)$/ },
    { regex: /(_chapter_)(\d+)()$/ },
  ];

  const LNW_SKIP_PATTERNS: { regex: RegExp }[] = [
    { regex: /(\/chapter\/)(\d+)(\/?)$/ },
    { regex: /(chapter[-_]?)(\d+)()/i },
  ];

  const tryDirectSkip = (firstChapterUrl: string, targetChapter: number): string | null => {
    if (isAsianovel(firstChapterUrl)) {
      // No reliable way to guess a chapter's real URL from a target chapter
      // number on this site — always fall back to the sequential crawl,
      // which correctly walks the real chapter-index list instead.
      return null;
    }

    if (isLightNovelWorld(firstChapterUrl)) {
      for (const { regex } of LNW_SKIP_PATTERNS) {
        if (regex.test(firstChapterUrl)) {
          return firstChapterUrl.replace(
            regex,
            (_m: string, prefix: string, _num: string, suffix: string) =>
              `${prefix}${targetChapter}${suffix}`
          );
        }
      }
      // Last resort for LNW only: bare trailing-number replace.
      if (/chapter/i.test(firstChapterUrl)) {
        const slashPattern = /\/(\d+)(\/?)$/;
        if (slashPattern.test(firstChapterUrl)) {
          return firstChapterUrl.replace(
            slashPattern,
            (_m: string, _num: string, trailingSlash: string) => `/${targetChapter}${trailingSlash}`
          );
        }
      }
      return null;
    }

    // Non-LNW sources: only the narrow, exact-suffix patterns.
    for (const { regex } of CHAPTER_SKIP_PATTERNS) {
      if (regex.test(firstChapterUrl)) {
        return firstChapterUrl.replace(
          regex,
          (_m: string, prefix: string, _num: string, suffix: string) =>
            `${prefix}${targetChapter}${suffix}`
        );
      }
    }
    return null;
  };

  // ─── Main update handler ─────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!selectedNovel) {
      addLog("Please select a novel first", "error");
      return;
    }

    if (chapterLimiter.dangerModalVisible) {
      addLog("Acknowledge the chapter limit warning before starting.", "warning");
      return;
    }

    const existingChapters = [...selectedNovel.chapters];
    const existingCount = existingChapters.length;
    const startCh = Math.max(1, parseInt(startChStr) || getNextStartChapter(selectedNovel));
    const parsedMaxCh = parseInt(maxChStr) || null;
    const maxCh = parsedMaxCh !== null ? Math.min(parsedMaxCh, CHAPTER_LIMIT_MAX) : null;

    stopRef.current = false;
    setIsUpdating(true);
    setLogs([]);
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
      const sourceIsChapterUrl = NOVEL_SOURCE_CHAPTER_PATTERN.test(selectedNovel.sourceUrl);
      if (sourceIsChapterUrl) {
        const chapterIndex = selectedNovel.sourceUrl.search(NOVEL_SOURCE_CHAPTER_PATTERN);
        metaUrl = selectedNovel.sourceUrl.slice(0, chapterIndex).replace(/\/$/, "");
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(`CONNECTING TO SOURCE...`, "downloading");
      addLog(`Source Domain: ${domain}`, "info");
      if (sourceIsChapterUrl) {
        addLog(`Chapter URL detected in saved source — using novel info page: ${metaUrl}`, "info");
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
        updatedCoverUrl = await downloadAndSaveCover(meta.coverUrl, selectedNovel.id);
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
              addLog(`Direct skip guess landed on a "Page Not Found" page, falling back to crawl...`, "warning");
            } else {
              addLog(`Direct skip to chapter ${startCh} (URL pattern matched)`, "success");
              currentUrl = directUrl;
              chapterNum = startCh;
              directSkipWorked = true;
              prefetchedChapter = { url: directUrl, chapterNum: startCh, data: testData };
            }
          } catch {
            addLog(`Direct skip guess was invalid, falling back to crawl...`, "warning");
          }
        }

        if (!directSkipWorked) {
          currentUrl = meta.firstChapterUrl;
          chapterNum = 1;
          addLog(`Crawling to chapter ${startCh} (no URL pattern detected)...`, "warning");

          let skippedCount = 0;
          let lastLoggedMilestone = 0;
          const totalToSkip = startCh - 1;

          while (currentUrl && chapterNum < startCh && !stopRef.current) {
            try {
              const { nextUrl } = await getChapterMetadata(currentUrl, chapterNum);
              currentUrl = nextUrl;
              chapterNum++;
              skippedCount++;

              const percent = Math.floor((skippedCount / totalToSkip) * 100);
              const nextMilestone = lastLoggedMilestone + 20;
              if (percent >= nextMilestone && nextMilestone <= 80) {
                addLog(
                  `Skipping... ${nextMilestone}% (${skippedCount}/${totalToSkip})`,
                  "warning"
                );
                lastLoggedMilestone = nextMilestone;
              }
            } catch {
              addLog(`Failed to skip chapter ${chapterNum}, retrying...`, "warning");
              try {
                const { nextUrl } = await getChapterMetadata(currentUrl!, chapterNum);
                currentUrl = nextUrl;
                chapterNum++;
                skippedCount++;
              } catch {
                addLog(`Skip aborted at chapter ${chapterNum}`, "error");
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 35));
            if (skippedCount % 20 === 0) await new Promise((r) => setTimeout(r, 0));
          }

          if (skippedCount > 0) {
            addLog(
              `Skipped ${skippedCount} chapters, ready at chapter ${startCh}`,
              "success"
            );
          }

          if (!currentUrl) {
            addLog(`Could not reach chapter ${startCh}. Update aborted.`, "error");
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
      const newChapters: (Chapter & { chapterNumber: number; content?: string })[] = [];
      const reDownloadedContent: { url: string; content: string; title: string }[] = [];
      let downloaded = 0;
      let consecutiveErrors = 0;
      let reDownloadedCount = 0;

      // Hard iteration ceiling so a broken nextUrl chain (site pagination bug,
      // redirect loop, etc.) can never spin forever without ever incrementing
      // `downloaded` — which is the only thing the maxCh check below looks at.
      const ITERATION_CEILING = (maxCh ?? CHAPTER_LIMIT_MAX) * 5 + 50;
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
        if (maxCh !== null && downloaded >= maxCh) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(`Reached max chapter limit (${maxCh})`, "success");
          break;
        }

        iterations++;
        if (iterations > ITERATION_CEILING) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(
            `Stopped: exceeded ${ITERATION_CEILING} chapter iterations without reaching the max chapter limit (${maxCh ?? "All"}). ` +
            `The source is likely stuck in a navigation loop. Check the scraper's nextUrl extraction for this site.`,
            "error"
          );
          break;
        }

        setProgressLabel(`Chapter ${chapterNum}`);
        if (maxCh) setProgress((downloaded / maxCh) * 100);

        // Check if chapter exists in library (by URL)
        const existsInLibrary = chapterExists(currentUrl, existingChapters);
        const existsInNew = chapterExists(currentUrl, newChapters);

        // A URL repeating at all in this run — whether it's a "new" chapter
        // or one we're re-downloading because content was missing — means
        // the site's "next chapter" link has looped back on itself. Treat
        // that as a hard stop instead of an infinite SKIPPED/re-download
        // loop (which also silently blocked the maxCh limit from ever being
        // reached, since `downloaded` never advanced).
        if (visitedThisRun.has(currentUrl)) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(
            `Stopped: Chapter ${chapterNum}'s URL was already fetched earlier in this run. ` +
            `The source's "next chapter" link is looping back on itself instead of moving forward.`,
            "error"
          );
          break;
        }
        visitedThisRun.add(currentUrl);

        let shouldDownload = false;
        let contentExists = false;

        if (existsInLibrary || existsInNew) {
          // Check if content file exists for this chapter
          if (existsInLibrary) {
            contentExists = await chapterHasContent(selectedNovel.id, currentUrl);
          } else if (existsInNew) {
            // It's in newChapters, which we just downloaded, so content should exist
            const found = newChapters.find(c => c.url === currentUrl);
            if (found && found.content) contentExists = true;
          }

          if (contentExists) {
            // Content is present → skip this chapter
            addLog(`SKIPPED: Chapter ${chapterNum} already has content`, "warning");
            // Get nextUrl using lightweight metadata
            try {
              const { nextUrl } = await getChapterMetadata(currentUrl, chapterNum);
              currentUrl = nextUrl;
              chapterNum++;
              continue;
            } catch {
              addLog(`Failed to get next chapter URL for ${chapterNum}, aborting skip`, "error");
              break;
            }
          } else {
            // Content is missing → re-download
            addLog(`Chapter ${chapterNum} exists but content is missing. Re-downloading...`, "warning");
            shouldDownload = true;
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
              addLog(`Using validated Chapter ${chapterNum} (already fetched)`, "downloading");
              data = prefetchedChapter.data;
            } else {
              addLog(`Downloading Chapter ${chapterNum}...`, "downloading");
              data = await fetchChapter(currentUrl, chapterNum);
            }
            // Prefetch cache is single-use — clear it after this iteration.
            prefetchedChapter = null;

            // Determine if this is a re-download or new
            if (existsInLibrary || existsInNew) {
              // Re-download: store content for later merging
              reDownloadedContent.push({
                url: currentUrl,
                content: data.content,
                title: data.title,
              });
              reDownloadedCount++;
              addLog(`Re-downloaded: ${data.title} (Chapter ${extractChapterNumber(data.title)})`, "success");
            } else {
              // New chapter
              const chapterNumber = extractChapterNumber(data.title);
              newChapters.push({
                title: data.title,
                url: currentUrl,
                content: data.content,
                chapterNumber,
              });
              downloaded++;
              addLog(`Saved: ${data.title} (Chapter ${chapterNumber})`, "success");
            }

            consecutiveErrors = 0;
            // Update progress label with total downloaded (new + re-downloaded)
            if (downloaded % 5 === 0) {
              addLog(`Saved ${downloaded} new chapter${downloaded !== 1 ? "s" : ""} so far`, "success");
            }

            if (!data.nextUrl) {
              addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
              addLog(`No more chapters found.`, "info");
              break;
            }
            currentUrl = data.nextUrl;
            chapterNum++;
          } catch (err: any) {
            consecutiveErrors++;
            addLog(`Failed to download Chapter ${chapterNum}: ${err.message}`, "error");

            if (consecutiveErrors >= 3) {
              addLog(`Too many consecutive errors, stopping update.`, "warning");
              break;
            }

            try {
              const { nextUrl } = await getChapterMetadata(currentUrl, chapterNum);
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
      if (downloaded > 0 || reDownloadedCount > 0 || updatedCoverUrl !== selectedNovel.coverUrl) {
        // Build final chapters list with content for those that have been updated
        const allChapters: (Chapter & { content?: string })[] = [...existingChapters];

        // Add new chapters
        newChapters.forEach((newCh) => {
          if (!chapterExists(newCh.url, allChapters)) {
            const { chapterNumber, ...chapterData } = newCh;
            allChapters.push(chapterData);
          }
        });

        // Merge re-downloaded content into existing entries
        reDownloadedContent.forEach(({ url, content, title }) => {
          const existing = allChapters.find(c => c.url === url);
          if (existing) {
            existing.content = content;
            // Optionally update title if it changed (rare)
            if (title) existing.title = title;
          }
        });

        addLog(`Sorting ${allChapters.length} chapters by chapter number...`, "info");

        allChapters.sort((a, b) => {
          const numA = extractChapterNumber(a.title);
          const numB = extractChapterNumber(b.title);
          if (numA === 0 && numB === 0) return (a.url || "").localeCompare(b.url || "");
          return numA - numB;
        });

        const validNums = allChapters.map(c => extractChapterNumber(c.title)).filter(n => n > 0);
        if (validNums.length > 0) {
          const minCh = Math.min(...validNums);
          const maxChNum = Math.max(...validNums);
          const missingCount = allChapters.length - validNums.length;
          addLog(
            `Chapters sorted: ${minCh} → ${maxChNum} (${allChapters.length} total${missingCount > 0 ? `, ${missingCount} untitled` : ""})`,
            "success"
          );
        }

        // Save all updated content to disk (only chapters that have `content` will be written)
        if (downloaded > 0 || reDownloadedCount > 0) {
          addLog(`Saving chapter content to disk...`, "info");
          await saveAllChaptersToFile(selectedNovel.id, allChapters);
        }

        // Strip content before persisting the lightweight chapters metadata
        const chaptersMetaOnly: Chapter[] = allChapters.map(({ content, ...rest }) => rest);

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
        if (reDownloadedCount > 0) {
          addLog(`Re-downloaded ${reDownloadedCount} chapters with missing content.`, "success");
        }
      } else if (sourceIsChapterUrl) {
        // No new chapters, but fix stored sourceUrl
        await updateNovel(selectedNovel.id, { sourceUrl: metaUrl });
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      if (stopRef.current) {
        addLog(`Update halted by user.`, "warning");
        addLog(`Downloaded ${downloaded} new chapters before stop.`, "info");
      } else if (downloaded === 0 && reDownloadedCount === 0) {
        addLog(`UPDATE COMPLETE!`, "success");
        addLog(`No new chapters and no missing content found. Novel is up to date!`, "success");
      } else {
        addLog(`UPDATE COMPLETE!`, "success");
        if (downloaded > 0) addLog(`New chapters added: ${downloaded}`, "success");
        if (reDownloadedCount > 0) addLog(`Re-downloaded chapters: ${reDownloadedCount}`, "success");
        addLog(`Novel updated in your library!`, "success");
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      setProgress(100);
    } catch (e: any) {
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
      addLog(`ERROR: ${e.message || "Update failed"}`, "error");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
    } finally {
      setIsUpdating(false);
      stopTimer();
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      color: colors.text,
    },
  ];

  const renderNovelItem = (novel: Novel) => (
    <Pressable
      key={novel.id}
      style={[
        styles.novelItem,
        {
          backgroundColor: selectedNovel?.id === novel.id ? colors.accent : colors.surface,
          borderColor: colors.border,
        },
      ]}
      onPress={() => {
        setSelectedNovel(novel);
        setShowNovelSearch(false);
        setNovelSearchQuery("");
        setStartChStr(getNextStartChapter(novel).toString());
      }}
    >
      <View style={styles.novelItemContent}>
        <Text
          style={[
            styles.novelTitle,
            { color: selectedNovel?.id === novel.id ? "#fff" : colors.text },
          ]}
          numberOfLines={2}
        >
          {novel.title}
        </Text>
        <Text
          style={[
            styles.novelChapters,
            { color: selectedNovel?.id === novel.id ? colors.textMuted : colors.textSecondary },
          ]}
        >
          {novel.chapters.length} chapters
        </Text>
      </View>
      {selectedNovel?.id === novel.id && (
        <Ionicons name="checkmark-circle" size={20} color="#fff" style={styles.checkIcon} />
      )}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Ionicons name="refresh-circle" size={22} color={colors.accent} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Novel Updates</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Novel selector */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>SELECT NOVEL</Text>
            {novels.length > 3 && (
              <Pressable
                onPress={() => setShowNovelSearch(!showNovelSearch)}
                style={styles.searchToggle}
              >
                <Ionicons
                  name={showNovelSearch ? "close" : "search"}
                  size={18}
                  color={colors.accent}
                />
                <Text style={[styles.searchToggleText, { color: colors.accent }]}>
                  {showNovelSearch ? "Close" : "Search"}
                </Text>
              </Pressable>
            )}
          </View>

          {showNovelSearch && novels.length > 3 && (
            <Animated.View entering={FadeIn} style={styles.searchContainer}>
              <View
                style={[
                  styles.searchInputContainer,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  style={[styles.novelSearchInput, { color: colors.text }]}
                  placeholder="Search by title or author..."
                  placeholderTextColor={colors.textMuted}
                  value={novelSearchQuery}
                  onChangeText={setNovelSearchQuery}
                  autoFocus
                />
                {novelSearchQuery.length > 0 && (
                  <Pressable onPress={() => setNovelSearchQuery("")}>
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </Pressable>
                )}
              </View>
              <Text style={[styles.searchResultText, { color: colors.textSecondary }]}>
                {filteredNovels.length} novel{filteredNovels.length !== 1 ? "s" : ""} found
              </Text>
            </Animated.View>
          )}

          <View style={styles.novelListContainer}>
            {novels.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No novels in library. Add some first!
              </Text>
            ) : filteredNovels.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No novels matching "{novelSearchQuery}"
              </Text>
            ) : (
              <ScrollView
                style={styles.novelScrollView}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
              >
                <View style={styles.novelListInner}>
                  {filteredNovels.map((novel) => renderNovelItem(novel))}
                </View>
              </ScrollView>
            )}
          </View>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Start Chapter</Text>
              <TextInput
                style={inputStyle}
                value={startChStr}
                onChangeText={setStartChStr}
                placeholder={selectedNovel ? `${getNextStartChapter(selectedNovel)}` : "Auto"}
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                editable={!isUpdating}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.label,
                  {
                    color: chapterLimiter.isDanger
                      ? Colors.error
                      : chapterLimiter.isCaution
                      ? Colors.amber
                      : colors.textSecondary,
                  },
                ]}
              >
                Max Chapters {chapterLimiter.isCaution ? `(max ${CHAPTER_LIMIT_MAX})` : ""}
              </Text>
              <TextInput
                style={[
                  inputStyle,
                  chapterLimiter.isDanger
                    ? { borderColor: Colors.error, color: Colors.error }
                    : chapterLimiter.isCaution
                    ? { borderColor: Colors.amber }
                    : null,
                ]}
                value={maxChStr}
                onChangeText={chapterLimiter.onMaxChStrChange}
                placeholder="All"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
                editable={!isUpdating}
              />
            </View>
          </View>

          <View style={styles.buttons}>
            <Pressable
              style={[
                styles.primaryBtn,
                { backgroundColor: isUpdating || !selectedNovel ? colors.border : colors.accent },
              ]}
              onPress={isUpdating ? undefined : handleUpdate}
              disabled={isUpdating || !selectedNovel}
            >
              {isUpdating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="download" size={18} color="#fff" />
              )}
              <Text style={styles.primaryBtnText}>
                {isUpdating ? "Updating..." : "Check for Updates"}
              </Text>
            </Pressable>

            {isUpdating && (
              <Pressable
                style={[styles.outlineBtn, { borderColor: Colors.error }]}
                onPress={() => { stopRef.current = true; }}
              >
                <Ionicons name="stop" size={16} color={Colors.error} />
                <Text style={[styles.outlineBtnText, { color: Colors.error }]}>Halt</Text>
              </Pressable>
            )}

            {!isUpdating && (
              <Pressable
                style={[styles.outlineBtn, { borderColor: colors.border }]}
                onPress={clearAll}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.outlineBtnText, { color: colors.textSecondary }]}>Clear</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Progress */}
        {(isUpdating || progress > 0) && (
          <Animated.View entering={FadeIn}>
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Ionicons name="bar-chart" size={15} color={colors.accent} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Progress</Text>
                {progressLabel ? (
                  <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                    {progressLabel}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.accent, width: `${Math.min(progress, 100)}%` },
                  ]}
                />
              </View>
            </View>
          </Animated.View>
        )}

        {/* Elapsed Time */}
        {(isUpdating || elapsedTime !== "00:00:00") && (
          <View style={styles.timerSection}>
            <View style={styles.timerHeader}>
              <Ionicons name="time-outline" size={15} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Elapsed Time</Text>
              <Text style={[styles.timerValue, { color: colors.accent }]}>{elapsedTime}</Text>
            </View>
          </View>
        )}

        {/* Activity Log */}
        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Ionicons name="sync" size={15} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Activity Log</Text>
          </View>
          <ScrollView
            ref={logScrollRef}
            style={[styles.logBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
            contentContainerStyle={styles.logContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {logs.length === 0 ? (
              <Text style={[styles.logLine, { color: colors.textMuted }]}>
                {selectedNovel
                  ? `Ready to check for updates in "${selectedNovel.title}"`
                  : "Select a novel to check for updates"}
              </Text>
            ) : (
              logs.map((entry) => <LogLine key={entry.id} entry={entry} />)
            )}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Chapter Limiter Danger Modal */}
      <ChapterLimitModal
        visible={chapterLimiter.dangerModalVisible}
        chapterCount={chapterLimiter.currentValue}
        onLower={chapterLimiter.lowerToSafeValue}
        onProceed={chapterLimiter.closeDangerModal}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  scroll: { padding: 16, gap: 16, flexGrow: 1 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 0.8 },
  searchToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  searchToggleText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  searchContainer: { marginBottom: 12, gap: 6 },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  novelSearchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, paddingVertical: 4 },
  searchResultText: { fontFamily: "Inter_400Regular", fontSize: 11, paddingLeft: 4 },
  novelListContainer: { minHeight: 0 },
  novelScrollView: { maxHeight: 240 },
  novelListInner: { gap: 8 },
  novelItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  novelItemContent: { flex: 1 },
  novelTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 4 },
  novelChapters: { fontFamily: "Inter_400Regular", fontSize: 11 },
  checkIcon: { marginLeft: 8 },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
  },
  form: { gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 6 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  buttons: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  outlineBtnText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  progressSection: { gap: 8 },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerSection: { gap: 8, marginBottom: 16 },
  timerHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerValue: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginLeft: "auto" },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },
  progressLabel: { fontFamily: "Inter_400Regular", fontSize: 12 },
  progressBar: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  logSection: { gap: 8, marginBottom: 22 },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  logBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    maxHeight: 350,
    minHeight: 150,
  },
  logContent: { paddingBottom: 38 },
  logLine: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
});
