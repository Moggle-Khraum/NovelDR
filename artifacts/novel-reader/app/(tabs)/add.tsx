import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useLibrary, Novel, Chapter } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchNovelMeta, fetchChapter } from "@/hooks/useApi";
import Colors from "@/constants/colors";

const SUPPORTED_SITES = [
  { name: "ReadNovelFull" },
  { name: "NovelFullNet" },
  { name: "FreeWebNovel" },
  { name: "NovelBin" },
  { name: "LightNovelWorld" },
  { name: "AllNovelOrg" },
  { name: "NovGoNet" },
  { name: "NovelFullCom" },
];

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
    if (text.includes("First chapter")) return "🔗";
    if (text.includes("Downloading Chapter")) return "📥";
    if (text.includes("Saved:")) return "💾";
    if (text.includes("COMPLETE")) return "🎉";
    if (text.includes("ERROR")) return "❌";
    if (text.includes("SKIPPED")) return "⏭️";
    if (text.includes("limit")) return "✅";
    if (text.includes("halted")) return "⚠️";
    if (text.includes("No more chapters")) return "🏁";
    if (text.includes("[LNW]")) return "";  // icon already embedded in the text
    if (text.includes("━━━━")) return "";
    if (text.includes("Chapters sorted")) return "📚";
    if (text.includes("Chapter")) return "📖";
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

function SiteCell({ name }: { name: string }) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        styles.siteCell,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        style={[styles.siteName, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {name}
      </Text>
    </Pressable>
  );
}

export default function AddNovelScreen() {
  const { colors } = useTheme();
  const { addNovel, novels } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [url, setUrl] = useState("");
  const [startChStr, setStartChStr] = useState("1");
  const [maxChStr, setMaxChStr] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stopRef = useRef(false);
  const logScrollRef = useRef<ScrollView>(null);

  // Detect chapter URL and auto-fill Start Chapter
  const CHAPTER_URL_PATTERN = /\/chapter[-/](\d+)/i;
  const detectedChapterNum = url.match(CHAPTER_URL_PATTERN)?.[1] ?? null;
  const isChapterUrl = detectedChapterNum !== null;

  const handleUrlChange = (text: string) => {
    setUrl(text);
    const match = text.match(CHAPTER_URL_PATTERN);
    if (match) {
      setStartChStr(match[1]);
    } else if (!text.trim()) {
      setStartChStr("1");
    }
  };

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

  const addLog = (text: string, type: LogEntry["type"] = "info") => {
    const entry: LogEntry = { id: Date.now().toString() + Math.random(), text, type };
    setLogs((prev) => [...prev.slice(-200), entry]);
    setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const clearAll = () => {
    setUrl("");
    setStartChStr("1");
    setMaxChStr("");
    setLogs([]);
    setProgress(0);
    setProgressLabel("");
    setElapsedTime("00:00:00");
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // Lightweight helper — fetches only next URL and title, no full content processing
  const getChapterMetadata = async (
    url: string,
    chapterNum: number
  ): Promise<{ nextUrl: string | null; title: string }> => {
    const data = await fetchChapter(url, chapterNum);
    return { nextUrl: data.nextUrl || null, title: data.title };
  };

  // Extract chapter number from title
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

  // Download cover image to local file system
  const downloadAndSaveCover = async (coverUrl: string, novelId: string): Promise<string> => {
    if (!coverUrl) return '';
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
      console.warn('Failed to download cover:', err);
      addLog(`Cover download failed, using remote URL`, "warning");
      return coverUrl;
    }
  };

  const handleDownload = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      addLog("Error: URL field is empty!", "error");
      return;
    }
    if (!trimmedUrl.startsWith("http")) {
      addLog("Error: Please enter a valid URL starting with http/https", "error");
      return;
    }

    const startCh = Math.max(1, parseInt(startChStr) || 1);
    const maxCh = parseInt(maxChStr) || null;

    // ── Detect if a chapter URL was pasted directly ──────────────────────────
    // Matches patterns like /chapter-942, /chapter/942, /ch-942
    const chapterUrlPattern = /\/chapter[-/](\d+)/i;
    const chapterUrlMatch = trimmedUrl.match(chapterUrlPattern);
    const isChapterUrl = !!chapterUrlMatch;

    // Derive novel homepage URL by stripping everything from /chapter onwards
    let metaUrl = trimmedUrl;
    let directChapterUrl: string | null = null;
    let directChapterNum = startCh;

    if (isChapterUrl) {
      const chapterIndex = trimmedUrl.search(chapterUrlPattern);
      metaUrl = trimmedUrl.slice(0, chapterIndex).replace(/\/$/, '');
      directChapterUrl = trimmedUrl;
      directChapterNum = parseInt(chapterUrlMatch![1]) || startCh;
      addLog(`Chapter URL detected — fetching novel info from: ${metaUrl}`, "info");
    }
    // ─────────────────────────────────────────────────────────────────────────

    stopRef.current = false;
    setIsDownloading(true);
    setLogs([]);
    setProgress(0);
    startTimer();

    try {
      const meta = await fetchNovelMeta(metaUrl);
      
      const existingNovel = novels.find(
        (n) => n.title.toLowerCase() === meta.title.toLowerCase()
      );
      
      if (existingNovel) {
        Alert.alert(
          "📚 Novel Already Exists",
          `"${meta.title}" is already in your library with ${existingNovel.chapters.length} chapters.\n\nYou can update it from the Updates tab if needed.`,
          [
            {
              text: "OK",
              onPress: () => { setUrl(""); setProgress(0); }
            },
            {
              text: "Go to Updates",
              onPress: () => {
                setUrl(""); setProgress(0);
                router.push("/(tabs)/updates");
              }
            }
          ]
        );
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
        const shortSynopsis = meta.synopsis.length > 100
          ? meta.synopsis.substring(0, 100) + "..."
          : meta.synopsis;
        addLog(`Synopsis: ${shortSynopsis}`, "info");
      }
      
      if (meta.coverUrl) addLog(`Cover found, downloading...`, "info");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      if (!meta.firstChapterUrl) {
        addLog("Could not find chapter links on this page", "error");
        setIsDownloading(false);
        return;
      }

      addLog(`First chapter URL found`, "success");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      const safeId =
        meta.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") +
        "-" + Date.now();

      let localCoverUrl = "";
      if (meta.coverUrl) {
        localCoverUrl = await downloadAndSaveCover(meta.coverUrl, safeId);
      }

      // ── If a chapter URL was pasted, skip directly to it ─────────────────
      // Override firstChapterUrl with the pasted chapter URL and set chapterNum
      // to the number extracted from the URL — bypasses the skip/crawl logic.
      let currentUrl: string | null = directChapterUrl ?? meta.firstChapterUrl;
      let chapterNum = directChapterUrl ? directChapterNum : 1;

      if (directChapterUrl) {
        addLog(`Starting directly from chapter ${directChapterNum}`, "success");
        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      }

      // ========== SKIP CHAPTERS BEFORE START CHAPTER ==========
      // Only runs when a novel homepage URL was pasted (not a chapter URL)
      if (!directChapterUrl && startCh > 1) {
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
          // 35ms between skipped chapters — fast but courteous to the server
          await new Promise((r) => setTimeout(r, 35));
        }

        if (skippedCount > 0) {
          addLog(
            `Skipped ${skippedCount} chapters, ready at chapter ${startCh}`,
            "success"
          );
        }

        if (!currentUrl) {
          addLog(`Could not reach chapter ${startCh}. Download aborted.`, "error");
          stopTimer();
          setIsDownloading(false);
          return;
        }

        addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      }

      // ========== DOWNLOAD CHAPTERS ==========
      const newChapters: (Chapter & { chapterNumber: number })[] = [];
      let downloaded = 0;

      addLog(`Starting from chapter ${chapterNum}...`, "downloading");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");

      while (currentUrl && !stopRef.current) {
        if (maxCh !== null && downloaded >= maxCh) {
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          addLog(`Reached max chapter limit (${maxCh})`, "success");
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
          break;
        }

        setProgressLabel(`Chapter ${chapterNum}`);
        if (maxCh) setProgress((downloaded / maxCh) * 100);
        
        addLog(`Downloading Chapter ${chapterNum}...`, "downloading");

        try {
          const data = await fetchChapter(currentUrl, chapterNum);
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
              si.selector === 'chapterText'  ? '🎯 #chapterText'  :
              si.selector === 'chapter-text' ? '🔄 .chapter-text' :
                                               '⚠️ generic fallback';
            const methodLabel = si.fetchMethod === 'fetch-proxy' ? '🔀 fetch (proxy)' : '🌐 fetch (direct)';
            const injectedLabel = si.jsInjected ? '⚠️ JS injection detected' : '✅ Clean HTML';
            const idCountLabel = si.chapterTextCount !== 1 ? `  ⚠️ #chapterText x${si.chapterTextCount}` : '';
            addLog(`[LNW] ── Connection ──────────────────`, 'info');
            addLog(`[LNW] Method : ${methodLabel}`, 'info');
            addLog(`[LNW] Status : HTTP ${si.httpStatus}  ${si.contentType}`, 'info');
            addLog(`[LNW] Server : ${injectedLabel}${idCountLabel}`, si.jsInjected ? 'warning' : 'info');
            addLog(`[LNW] ── Extraction ─────────────────`, 'info');
            addLog(`[LNW] Selector  : ${selectorLabel}`, si.selector === 'generic-fallback' ? 'warning' : 'info');
            addLog(`[LNW] HTML size : ${Math.round(si.htmlLength / 1024)}kb  <p> tags: ${si.pTagCount}`, 'info');
            addLog(`[LNW] Paragraphs: raw ${si.rawCount} → filtered ${si.filteredCount}`, 'info');
            addLog(`[LNW] ─────────────────────────────`, 'info');
          }

          if (downloaded % 10 === 0) {
            addLog(
              `Saved: ${data.title} (Chapter ${chapterNumber}) [${downloaded} chapters so far]`,
              "success"
            );
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
          addLog(`Failed to download Chapter ${chapterNum}: ${err.message}`, "error");
          break;
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      // ========== SORT & FINALIZE ==========
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      addLog(`Sorting ${newChapters.length} chapters by chapter number...`, "info");

      newChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

      if (newChapters.length > 0) {
        const validNums = newChapters.map(c => c.chapterNumber).filter(n => n > 0);
        if (validNums.length > 0) {
          const minCh = Math.min(...validNums);
          const maxChNum = Math.max(...validNums);
          const missing = newChapters.length - validNums.length;
          addLog(
            `Chapters sorted: ${minCh} → ${maxChNum} (${newChapters.length} total${missing > 0 ? `, ${missing} untitled` : ""})`,
            "success"
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

      const finalChapters = newChapters.map(({ chapterNumber, ...ch }) => ch);

      const novel: Novel = {
        id: safeId,
        title: meta.title,
        author: meta.author,
        synopsis: meta.synopsis,
        coverUrl: localCoverUrl || meta.coverUrl,
        sourceUrl: trimmedUrl,
        chapters: finalChapters,
        dateAdded: Date.now(),
        status: "unread",
      };
      await addNovel(novel);
      setProgress(100);
    } catch (e: any) {
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
      addLog(`ERROR: ${e.message || "Download failed"}`, "error");
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "error");
    } finally {
      setIsDownloading(false);
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Ionicons name="cloud-download" size={22} color={colors.accent} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Download Novel</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={true}
        alwaysBounceVertical={true}
      >
        {/* Supported Sites Section */}
        <View style={styles.sitesSection}>
          <View style={styles.sitesHeader}>
            <Ionicons name="globe" size={16} color={colors.accent} />
            <Text style={[styles.sitesHeaderLabel, { color: colors.textSecondary }]}>SUPPORTED SITES</Text>
          </View>
          <View style={[styles.sitesGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {SUPPORTED_SITES.map((site) => (
              <SiteCell key={site.name} name={site.name} />
            ))}
          </View>
        </View>

        {/* Form Section */}
        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Novel URL</Text>
            <TextInput
              style={inputStyle}
              value={url}
              onChangeText={handleUrlChange}
              placeholder="https://readnovelfull.com/novel-name.html"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isDownloading}
            />
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Start Chapter{isChapterUrl ? ' 🔗' : ''}
              </Text>
              <TextInput
                style={[inputStyle, isChapterUrl && { opacity: 0.5 }]}
                value={startChStr}
                onChangeText={setStartChStr}
                placeholder="1"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                editable={!isDownloading && !isChapterUrl}
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
                editable={!isDownloading}
              />
            </View>
          </View>

          <View style={styles.buttons}>
            <Pressable
              style={[
                styles.primaryBtn,
                { backgroundColor: isDownloading ? colors.border : colors.accent },
              ]}
              onPress={isDownloading ? undefined : handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="download" size={18} color="#fff" />
              )}
              <Text style={styles.primaryBtnText}>
                {isDownloading ? "Downloading..." : "Start Download"}
              </Text>
            </Pressable>

            {isDownloading && (
              <Pressable
                style={[styles.outlineBtn, { borderColor: Colors.error }]}
                onPress={() => { stopRef.current = true; }}
              >
                <Ionicons name="stop" size={16} color={Colors.error} />
                <Text style={[styles.outlineBtnText, { color: Colors.error }]}>Halt</Text>
              </Pressable>
            )}

            {!isDownloading && (
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

        {/* Progress Section */}
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
                {
                  backgroundColor: colors.accent,
                  width: `${Math.min(progress, 100)}%`,
                },
              ]}
            />
          </View>
        </View>

        {/* Elapsed Time Section */}
        {(isDownloading || elapsedTime !== "00:00:00") && (
          <View style={styles.timerSection}>
            <View style={styles.timerHeader}>
              <Ionicons name="time-outline" size={15} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Elapsed Time</Text>
              <Text style={[styles.timerValue, { color: colors.accent }]}>{elapsedTime}</Text>
            </View>
          </View>
        )}

        {/* Activity Log Section */}
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
                Ready to download...
              </Text>
            ) : (
              logs.map((entry) => <LogLine key={entry.id} entry={entry} />)
            )}
          </ScrollView>
        </View>

        <View style={styles.bottomSpacer} />
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
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sitesSection: {
    marginBottom: 16,
  },
  sitesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sitesHeaderLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
  },
  sitesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  siteCell: {
    width: "31%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  siteName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textAlign: "center",
  },
  form: {
    gap: 14,
    marginBottom: 16,
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  row: { flexDirection: "row", gap: 12 },
  buttons: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  outlineBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  progressSection: {
    gap: 8,
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    flex: 1,
  },
  progressLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  timerSection: {
    gap: 8,
    marginBottom: 16,
  },
  timerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    marginLeft: "auto",
  },
  logSection: {
    gap: 8,
    marginBottom: 16,
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    maxHeight: 280,
    minHeight: 150,
  },
  logContent: {
    paddingBottom: 8,
  },
  logLine: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  bottomSpacer: {
    height: 20,
  },
});
