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
import Colors from "@/constants/colors";

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
  const { novels, updateNovel } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null);
  const [startChStr, setStartChStr] = useState("");
  const [maxChStr, setMaxChStr] = useState("");
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

  // ─── Chapter exists check ────────────────────────────────────────────────────
  const chapterExists = (url: string, existingChapters: Chapter[]): boolean =>
    existingChapters.some((c) => c.url === url);

  // ─── Lightweight metadata fetch (next URL only, no content parsing) ──────────
  const getChapterMetadata = async (
    url: string,
    chapterNum: number
  ): Promise<{ nextUrl: string | null }> => {
    try {
      const isFreeWebNovel =
        url.toLowerCase().includes("freewebnovel") ||
        url.toLowerCase().includes("bednovel");

      let html: string;
      if (isFreeWebNovel) {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        html = await res.text();
      } else {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        html = await res.text();
      }

      const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").trim();
      const makeAbsolute = (rel: string, base: string) => {
        if (!rel) return base;
        if (rel.startsWith("http")) return rel;
        try { return new URL(rel, base).href; } catch { return rel; }
      };

      const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const attrsStr = linkMatch[1];
        const hrefMatch = attrsStr.match(/href=["']([^"']+)["']/i);
        const href = hrefMatch ? hrefMatch[1] : null;
        const txt = stripTags(linkMatch[2]).toLowerCase();
        const classAttr = (attrsStr.match(/class=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();
        const idAttr = (attrsStr.match(/id=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();
        const attrs = classAttr + " " + idAttr;
        if (
          (txt.includes("next") ||
            txt.includes("next chapter") ||
            attrs.includes("next") ||
            attrs.includes("next_chapter")) &&
          href
        ) {
          return { nextUrl: makeAbsolute(href, url) };
        }
      }
      return { nextUrl: null };
    } catch {
      // Fallback to full fetchChapter if lightweight fetch fails
      const data = await fetchChapter(url, chapterNum);
      return { nextUrl: data.nextUrl || null };
    }
  };

  // ─── Main update handler (direct skip removed) ──────────────────────────────
  const handleUpdate = async () => {
    if (!selectedNovel) {
      addLog("Please select a novel first", "error");
      return;
    }

    const existingChapters = [...selectedNovel.chapters];
    const existingCount = existingChapters.length;
    const startCh = Math.max(1, parseInt(startChStr) || existingCount + 1);
    const maxCh = parseInt(maxChStr) || null;

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

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(`CONNECTING TO SOURCE...`, "downloading");
      addLog(`Source Domain: ${domain}`, "info");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      const meta = await fetchNovelMeta(selectedNovel.sourceUrl);

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

      // ========== SKIP TO START CHAPTER (always crawl sequentially) ==========
      let currentUrl: string | null = meta.firstChapterUrl;
      let chapterNum = 1;

      if (startCh > 1) {
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
        addLog(`Skipping to chapter ${startCh}...`, "downloading");
        addLog(`Crawling to chapter ${startCh} (sequential via nextUrl)`, "warning");

        let skippedCount = 0;
        let lastLoggedMilestone = 0;
        const totalToSkip = startCh - 1;

        while (currentUrl && chapterNum < startCh && !stopRef.current) {
          try {
            const { nextUrl } = await getChapterMetadata(currentUrl, chapterNum);
            currentUrl = nextUrl;
            chapterNum++;
            skippedCount++;

            // Log at every 20% milestone
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

        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      }

      addLog(`Starting download from chapter ${chapterNum}...`, "downloading");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      // ========== DOWNLOAD NEW CHAPTERS ==========
      const newChapters: (Chapter & { chapterNumber: number })[] = [];
      let downloaded = 0;
      let consecutiveErrors = 0;

      while (currentUrl && !stopRef.current) {
        if (maxCh !== null && downloaded >= maxCh) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(`Reached max chapter limit (${maxCh})`, "success");
          break;
        }

        setProgressLabel(`Chapter ${chapterNum}`);
        if (maxCh) setProgress((downloaded / maxCh) * 100);

        addLog(`Downloading Chapter ${chapterNum}...`, "downloading");

        try {
          const data = await fetchChapter(currentUrl, chapterNum);

          if (
            !chapterExists(currentUrl, existingChapters) &&
            !chapterExists(currentUrl, newChapters)
          ) {
            const chapterNumber = extractChapterNumber(data.title);
            newChapters.push({
              title: data.title,
              url: currentUrl,
              content: data.content,
              chapterNumber,
            });
            downloaded++;
            consecutiveErrors = 0;

            if (downloaded % 5 === 0) {
              addLog(`Saved ${downloaded} new chapter${downloaded !== 1 ? "s" : ""} so far`, "success");
            } else {
              addLog(`Saved: ${data.title} (Chapter ${chapterNumber})`, "success");
            }
          } else {
            addLog(`SKIPPED: Chapter ${chapterNum} already exists`, "warning");
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

      // ========== FINALIZE & SORT ==========
      if (downloaded > 0 || updatedCoverUrl !== selectedNovel.coverUrl) {
        const allChapters = [...existingChapters];

        newChapters.forEach((newCh) => {
          if (!chapterExists(newCh.url, allChapters)) {
            const { chapterNumber, ...chapterData } = newCh;
            allChapters.push(chapterData);
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

        await updateNovel(selectedNovel.id, {
          chapters: allChapters,
          coverUrl: updatedCoverUrl,
          author: meta.author,
          synopsis: meta.synopsis,
        });

        if (downloaded > 0) {
          addLog(`Novel updated with ${downloaded} new chapters!`, "success");
        }
      }

      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      if (stopRef.current) {
        addLog(`Update halted by user.`, "warning");
        addLog(`Downloaded ${downloaded} new chapters before stop.`, "info");
      } else if (downloaded === 0) {
        addLog(`UPDATE COMPLETE!`, "success");
        addLog(`No new chapters found. Novel is up to date!`, "success");
      } else {
        addLog(`UPDATE COMPLETE!`, "success");
        addLog(`Total new chapters added: ${downloaded}`, "success");
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
        setStartChStr((novel.chapters.length + 1).toString());
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
                placeholder={selectedNovel ? `${selectedNovel.chapters.length + 1}` : "Auto"}
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                editable={!isUpdating}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Max Chapters</Text>
              <TextInput
                style={inputStyle}
                value={maxChStr}
                onChangeText={setMaxChStr}
                placeholder="All"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
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
