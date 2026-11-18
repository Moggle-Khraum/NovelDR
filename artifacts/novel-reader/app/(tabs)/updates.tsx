import { Ionicons } from "@expo/vector-icons";
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
import {
  useChapterLimiter,
  CHAPTER_LIMIT_MAX,
} from "@/hooks/useChapterLimiter";
import { ChapterLimitModal } from "@/components/ChapterLimitModal";
import { confirmPausedSiteJob, isPausedSiteUrl } from "@/lib/pausedSitePrompt";
import { useHaltControl } from "@/hooks/useHaltControl";
import {
  runUpdate,
  hostOf,
  DEFAULT_MAX_CHAPTERS,
  getNextStartChapter,
} from "@/lib/updateEngine";
import {
  checkDeprecatedSite,
  getDeprecatedSiteMessage,
} from "@/hooks/scrapers/deprecatedSites";
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
  const {
    novels,
    updateNovel,
    saveAllChaptersToFile,
    applyChapterFileMoves,
    loadChapterContent,
  } = useLibrary();
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
  // Halt: countdown button; at zero it aborts in-flight requests and WebView jobs.
  const halt = useHaltControl(isUpdating, () => {
    stopRef.current = true;
  });
  const logScrollRef = useRef<ScrollView>(null);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredNovels = useMemo(() => {
    if (!novelSearchQuery.trim()) return novels;
    const query = novelSearchQuery.toLowerCase().trim();
    return novels.filter(
      (n) =>
        n.title.toLowerCase().includes(query) ||
        n.author.toLowerCase().includes(query),
    );
  }, [novels, novelSearchQuery]);

  // ─── Log (capped at 500) ────────────────────────────────────────────────────
  const addLog = (text: string, type: LogEntry["type"] = "info") => {
    const entry: LogEntry = {
      id: Date.now().toString() + Math.random(),
      text,
      type,
    };
    setLogs((prev) => [...prev.slice(-500), entry]);
    setTimeout(
      () => logScrollRef.current?.scrollToEnd({ animated: true }),
      100,
    );
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

  // ─── Main update handler ─────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!selectedNovel) {
      addLog("Please select a novel first", "error");
      return;
    }

    // Same deprecated-site check as add.tsx, run against the saved source.
    const deprecatedCheck = checkDeprecatedSite(selectedNovel.sourceUrl);
    if (deprecatedCheck) {
      addLog(
        getDeprecatedSiteMessage(
          deprecatedCheck.siteName,
          deprecatedCheck.reason,
        ),
        "error",
      );
      return;
    }

    if (chapterLimiter.dangerModalVisible) {
      addLog(
        "Acknowledge the chapter limit warning before starting.",
        "warning",
      );
      return;
    }

    if (isPausedSiteUrl(selectedNovel.sourceUrl)) {
      const ok = await confirmPausedSiteJob(hostOf(selectedNovel.sourceUrl));
      if (!ok) {
        addLog("Update cancelled.", "info");
        return;
      }
    }
    await runUpdate(
      { novel: selectedNovel, startChStr, maxChStr },
      {
        stopRef,
        addLog,
        clearLogs: () => setLogs([]),
        setIsUpdating,
        setProgress,
        setProgressLabel,
        setElapsedTime,
        startTimer,
        stopTimer,
        library: {
          updateNovel,
          saveAllChaptersToFile,
          applyChapterFileMoves,
          loadChapterContent,
        },
      },
    );
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
          backgroundColor:
            selectedNovel?.id === novel.id ? colors.accent : colors.surface,
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
            {
              color:
                selectedNovel?.id === novel.id
                  ? colors.textMuted
                  : colors.textSecondary,
            },
          ]}
        >
          {novel.chapters.length} chapters
        </Text>
      </View>
      {selectedNovel?.id === novel.id && (
        <Ionicons
          name="checkmark-circle"
          size={20}
          color="#fff"
          style={styles.checkIcon}
        />
      )}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border },
        ]}
      >
        <Ionicons name="refresh-circle" size={22} color={colors.accent} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Novel Updates
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomPad + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Novel selector */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>
              SELECT NOVEL
            </Text>
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
                <Text
                  style={[styles.searchToggleText, { color: colors.accent }]}
                >
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
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="search"
                  size={18}
                  color={colors.textSecondary}
                />
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
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                )}
              </View>
              <Text
                style={[
                  styles.searchResultText,
                  { color: colors.textSecondary },
                ]}
              >
                {filteredNovels.length} novel
                {filteredNovels.length !== 1 ? "s" : ""} found
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
                No novels matching &quot;{novelSearchQuery}&quot;
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
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Start Chapter
              </Text>
              <TextInput
                style={inputStyle}
                value={startChStr}
                onChangeText={setStartChStr}
                placeholder={
                  selectedNovel
                    ? `${getNextStartChapter(selectedNovel)}`
                    : "Auto"
                }
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
                Max Chapters{" "}
                {chapterLimiter.isCaution ? `(max ${CHAPTER_LIMIT_MAX})` : ""}
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
                placeholder={`${DEFAULT_MAX_CHAPTERS}`}
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
                {
                  backgroundColor:
                    isUpdating || !selectedNovel
                      ? colors.border
                      : colors.accent,
                },
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
                onPress={halt.press}
                disabled={halt.disabled}
              >
                <Ionicons name="stop" size={16} color={Colors.error} />
                <Text style={[styles.outlineBtnText, { color: Colors.error }]}>
                  {halt.label}
                </Text>
              </Pressable>
            )}

            {!isUpdating && (
              <Pressable
                style={[styles.outlineBtn, { borderColor: colors.border }]}
                onPress={clearAll}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text
                  style={[
                    styles.outlineBtnText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Clear
                </Text>
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
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Progress
                </Text>
                {progressLabel ? (
                  <Text
                    style={[
                      styles.progressLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {progressLabel}
                  </Text>
                ) : null}
              </View>
              <View
                style={[styles.progressBar, { backgroundColor: colors.border }]}
              >
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
          </Animated.View>
        )}

        {/* Elapsed Time */}
        {(isUpdating || elapsedTime !== "00:00:00") && (
          <View style={styles.timerSection}>
            <View style={styles.timerHeader}>
              <Ionicons name="time-outline" size={15} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Elapsed Time
              </Text>
              <Text style={[styles.timerValue, { color: colors.accent }]}>
                {elapsedTime}
              </Text>
            </View>
          </View>
        )}

        {/* Activity Log */}
        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Ionicons name="sync" size={15} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Activity Log
            </Text>
          </View>
          <ScrollView
            ref={logScrollRef}
            style={[
              styles.logBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
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
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
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
  novelSearchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    paddingVertical: 4,
  },
  searchResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    paddingLeft: 4,
  },
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
  novelTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    marginBottom: 4,
  },
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
  outlineBtnText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  progressSection: { gap: 8 },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerSection: { gap: 8, marginBottom: 16 },
  timerHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    marginLeft: "auto",
  },
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
