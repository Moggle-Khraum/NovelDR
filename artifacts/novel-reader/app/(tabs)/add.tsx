import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import React, { memo, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import {
  useSiteHealth,
  SUPPORTED_SITES,
  SiteStatus,
  SiteLanguage,
} from "@/context/SiteHealthContext";
import { useLowMemory } from "@/context/LowMemoryContext";
import {
  useChapterLimiter,
  CHAPTER_LIMIT_MAX,
} from "@/hooks/useChapterLimiter";
import { ChapterLimitModal } from "@/components/ChapterLimitModal";
import { getSourceFlag } from "@/hooks/scrapers/sourceLanguages";
import { confirmPausedSiteJob, isPausedSiteUrl } from "@/lib/pausedSitePrompt";
import { useHaltControl } from "@/hooks/useHaltControl";
import {
  runAddDownload,
  DEFAULT_MAX_CHAPTERS,
  type AddEngineUi,
  type LogEntry,
} from "@/lib/addEngine";
import {
  checkDeprecatedSite,
  getDeprecatedSiteMessage,
} from "@/hooks/scrapers/deprecatedSites";
import Colors from "@/constants/colors";

const DEPRECATED_SITES = [
  { domain: "novelbin.me" },
  { domain: "novelbin.com" },
  { domain: "novelarrow" },
  { domain: "lightnovelworld.org" },
  { domain: "allnovel.org" },
];

// --- Reusable Log Line Component ---
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
    if (text.includes("[LNW]")) return "";
    if (text.includes("━━━━")) return "";
    if (text.includes("Chapters sorted")) return "📚";
    if (text.includes("Chapter")) return "📖";
    if (text.includes("health check")) return "🏥";
    if (text.includes("unreachable")) return "⚠️";
    if (text.includes("All sites are up")) return "✅";
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

// --- Status highlight colors ---
// Each status gets its own outline color instead of an emoji dot. Maintenance
// and 504 used to share amber and differ only by emoji, so maintenance is
// yellow and 504 orange. "checking" and "idle" have no highlight.
const STATUS_YELLOW = "#FFD60A";
const statusColor = (status: SiteStatus): string | null => {
  if (status === "online") return Colors.success;
  if (status === "offline") return Colors.error;
  if (status === "maintenance") return STATUS_YELLOW;
  if (status === "gateway_timeout") return Colors.amber;
  return null;
};

// --- Modal Cell ---
// Fixed row height (34) plus the 6px gap between rows. Keep in sync with
// styles.rowCell and styles.rowList.gap.
const SOURCE_ROW_STRIDE = 40;

// One full-width row per site: name on the left, status on the right.
// Active is green, Paused is blue-grey, a site that is down shows its state.
const ROW_ACTIVE = "#3ddc84";
const ROW_PAUSED = "#8fa8c8";
const ROW_DEAD = "#ff5c5c";

function SourceListRowBase({
  name,
  status,
  flag,
}: {
  name: string;
  status: SiteStatus;
  flag?: string | null;
}) {
  const { colors } = useTheme();
  const isDown =
    status === "offline" ||
    status === "maintenance" ||
    status === "gateway_timeout";
  const isPaused = status === "paused";
  const tone = isPaused
    ? ROW_PAUSED
    : isDown
      ? ROW_DEAD
      : status === "idle"
        ? colors.border
        : ROW_ACTIVE;
  const label = isPaused
    ? "Paused"
    : isDown
      ? "Down"
      : status === "idle"
        ? "Waiting"
        : "Active";

  return (
    <View
      style={[
        styles.rowCell,
        { borderColor: tone, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
        {flag ? `${name} ${flag}` : name}
      </Text>
      <Text style={[styles.rowStatus, { color: tone }]}>{label}</Text>
    </View>
  );
}

const SourceListRow = memo(SourceListRowBase);

// Deprecated site: domain on the left, DEAD on the right.
function DeprecatedRowBase({ domain }: { domain: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.rowCell,
        { borderColor: ROW_DEAD, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
        {domain}
      </Text>
      <Text style={[styles.rowStatus, { color: ROW_DEAD }]}>DEAD</Text>
    </View>
  );
}

const DeprecatedRow = memo(DeprecatedRowBase);

// --- Source List Modal ---
interface SourceListModalProps {
  visible: boolean;
  onClose: () => void;
  sites: typeof SUPPORTED_SITES;
  siteStatuses: Record<string, SiteStatus>;
  deprecatedSites?: { domain: string }[];
  langFilter: SiteLanguage;
  onLangFilterChange: (lang: SiteLanguage) => void;
}

function SourceListModal({
  visible,
  onClose,
  sites,
  siteStatuses,
  deprecatedSites,
  langFilter,
  onLangFilterChange,
}: SourceListModalProps) {
  const { colors } = useTheme();
  const { isChecking, recheck, networkSlow } = useSiteHealth();
  const pausedCount = Object.values(siteStatuses).filter(
    (status) => status === "paused",
  ).length;
  const lowMemory = useLowMemory();
  const [activeTab, setActiveTab] = useState<"active" | "deprecated">("active");

  const LANG_PILLS: { key: SiteLanguage; label: string }[] = [
    { key: "en", label: "\u{1F1FA}\u{1F1F8} EN" },
    { key: "mtl", label: "\u{1F916} MTL" },
    { key: "etc", label: "\u{1F310} ETC" },
  ];
  const filteredSites = sites.filter((site) => site.language === langFilter);

  const renderSite = useCallback(
    ({ item }: { item: (typeof SUPPORTED_SITES)[number] }) => (
      <SourceListRow
        name={item.name}
        status={siteStatuses[item.name] || "idle"}
        flag={getSourceFlag(item.baseUrl)}
      />
    ),
    [siteStatuses],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { height: "75%", maxHeight: undefined },
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.modalTitle,
              { color: colors.text, textAlign: "center" },
            ]}
          >
            Source List
          </Text>
          <View style={styles.headerRow}>
            {lowMemory.enabled ? (
              <View style={styles.lowModeBadge}>
                <Text style={styles.lowModeBadgeText}>Low Mode</Text>
              </View>
            ) : (
              <View />
            )}
            <Pressable
              onPress={() => recheck()}
              disabled={isChecking}
              style={[
                styles.recheckButton,
                { borderColor: colors.border, opacity: isChecking ? 0.5 : 1 },
              ]}
            >
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {isChecking ? "⏳" : "🔄"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {isChecking ? "Checking…" : "Recheck"}
              </Text>
            </Pressable>
          </View>

          {/* TAB NAVIGATION */}
          <View style={styles.tabNavigation}>
            <Pressable
              onPress={() => setActiveTab("active")}
              style={[
                styles.tabButton,
                activeTab === "active" && styles.tabButtonActive,
                {
                  borderBottomColor:
                    activeTab === "active" ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color:
                      activeTab === "active" ? colors.accent : colors.textMuted,
                  },
                ]}
              >
                ✅ Active Sites
              </Text>
            </Pressable>

            {deprecatedSites && deprecatedSites.length > 0 && (
              <Pressable
                onPress={() => setActiveTab("deprecated")}
                style={[
                  styles.tabButton,
                  activeTab === "deprecated" && styles.tabButtonActive,
                  {
                    borderBottomColor:
                      activeTab === "deprecated" ? Colors.amber : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color:
                        activeTab === "deprecated"
                          ? Colors.amber
                          : colors.textMuted,
                    },
                  ]}
                >
                  ⚠️ Deprecated Sites
                </Text>
              </Pressable>
            )}
          </View>

          {activeTab === "active" ? (
            <>
              <View style={styles.sectionContainer}>
                {networkSlow && (
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.textSecondary,
                      marginBottom: 8,
                    }}
                  >
                    Network is slow, so site checks stopped early. Tap Recheck
                    to try again.
                  </Text>
                )}
                <View style={styles.langPillRow}>
                  {LANG_PILLS.map((pill) => {
                    const selected = langFilter === pill.key;
                    return (
                      <Pressable
                        key={pill.key}
                        onPress={() => onLangFilterChange(pill.key)}
                        style={[
                          styles.langPill,
                          {
                            borderColor: selected
                              ? colors.accent
                              : colors.border,
                            backgroundColor: selected
                              ? colors.accent + "14"
                              : colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.langPillText,
                            {
                              color: selected
                                ? colors.accent
                                : colors.textMuted,
                            },
                          ]}
                        >
                          {pill.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <FlatList
                style={[
                  styles.scrollBox,
                  { borderColor: colors.border, flex: 1 },
                ]}
                key={langFilter}
                data={filteredSites}
                keyExtractor={(site) => site.name}
                contentContainerStyle={styles.rowList}
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                windowSize={5}
                maxToRenderPerBatch={8}
                removeClippedSubviews
                getItemLayout={(_, index) => ({
                  length: SOURCE_ROW_STRIDE,
                  offset: SOURCE_ROW_STRIDE * index,
                  index,
                })}
                ListEmptyComponent={
                  <Text style={[styles.langEmpty, { color: colors.textMuted }]}>
                    No sites in this group yet.
                  </Text>
                }
                renderItem={renderSite}
              />
            </>
          ) : (
            <ScrollView
              style={[styles.scrollBox, { borderColor: colors.border }]}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowList}
            >
              {deprecatedSites?.map((site) => (
                <DeprecatedRow key={site.domain} domain={site.domain} />
              ))}
            </ScrollView>
          )}
        </View>
        <Pressable
          onPress={onClose}
          style={[styles.sourceCloseButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.sourceCloseText, { color: colors.text }]}>
            Close
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// --- Main Component ---
export default function AddNovelScreen() {
  const { colors } = useTheme();
  const { addNovel, novels } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [url, setUrl] = useState("");
  const [startChStr, setStartChStr] = useState("1");
  const [maxChStr, setMaxChStr] = useState("");
  const chapterLimiter = useChapterLimiter(maxChStr, setMaxChStr);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const [sourceListModalVisible, setSourceListModalVisible] = useState(false);
  const [sourceListLang, setSourceListLang] = useState<SiteLanguage>("en");
  const openSourceList = (lang: SiteLanguage) => {
    setSourceListLang(lang);
    setSourceListModalVisible(true);
  };

  // --- Site Health Check State (owned by SiteHealthProvider at app root -
  // this just reads it, so status is already current by the time this
  // screen is visited, and doesn't restart checking on every tab visit) ---
  const { statuses: siteStatuses, isChecking: isCheckingSites } =
    useSiteHealth();
  const lowMemory = useLowMemory();

  // Up/total per language group, e.g. EN 13/13. Outline: none when the group
  // is empty, green when all are up, red when none are, orange when some are.
  const langSummary = (["en", "mtl", "etc"] as SiteLanguage[]).map((key) => {
    const group = SUPPORTED_SITES.filter((site) => site.language === key);
    const up = group.filter(
      (site) => (siteStatuses[site.name] || "idle") === "online",
    ).length;
    // Low Memory Mode is on: every group shows orange.
    const color =
      group.length === 0
        ? null
        : lowMemory.enabled
          ? Colors.amber
          : up === group.length
            ? Colors.success
            : up === 0
              ? Colors.error
              : Colors.amber;
    return { key, up, total: group.length, color };
  });
  const LANG_LABEL: Record<SiteLanguage, string> = {
    en: "EN",
    mtl: "MTL",
    etc: "ETC",
  };

  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef(false);
  // Halt: countdown button; at zero it aborts in-flight requests and WebView jobs.
  const halt = useHaltControl(isDownloading, () => {
    stopRef.current = true;
  });
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
    const entry: LogEntry = {
      id: Date.now().toString() + Math.random(),
      text,
      type,
    };
    setLogs((prev) => [...prev.slice(-200), entry]);
    setTimeout(
      () => logScrollRef.current?.scrollToEnd({ animated: true }),
      100,
    );
  };

  const clearAll = () => {
    setUrl("");
    setStartChStr("1");
    setMaxChStr("");
    chapterLimiter.resetLimiter();
    setLogs([]);
    setProgress(0);
    setProgressLabel("");
    setElapsedTime("00:00:00");
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const handleDownload = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      addLog("Error: URL field is empty!", "error");
      return;
    }
    if (!trimmedUrl.startsWith("http")) {
      addLog(
        "Error: Please enter a valid URL starting with http/https",
        "error",
      );
      return;
    }

    if (isPausedSiteUrl(trimmedUrl)) {
      const host = (() => {
        try {
          return new URL(trimmedUrl).hostname;
        } catch {
          return trimmedUrl;
        }
      })();
      const ok = await confirmPausedSiteJob(host);
      if (!ok) {
        addLog("Download cancelled.", "info");
        return;
      }
    }

    // ===== NEW: Check for deprecated sites =====
    const deprecatedCheck = checkDeprecatedSite(trimmedUrl);
    if (deprecatedCheck) {
      const message = getDeprecatedSiteMessage(
        deprecatedCheck.siteName,
        deprecatedCheck.reason,
      );
      addLog(message, "error");
      return;
    }
    // ===== END: Deprecated sites check =====

    if (chapterLimiter.dangerModalVisible) {
      addLog(
        "Acknowledge the chapter limit warning before starting.",
        "warning",
      );
      return;
    }

    // ── Low-storage guard: warn if free space is under 200MB ─────────────────
    try {
      const freeBytes = await FileSystem.getFreeDiskStorageAsync();
      const LOW_STORAGE_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200MB

      if (freeBytes < LOW_STORAGE_THRESHOLD_BYTES) {
        const freeMB = (freeBytes / (1024 * 1024)).toFixed(0);
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "⚠️ Low Storage",
            `Only ${freeMB}MB of free space remains on your device. Downloading this novel may fail partway through or fill up your storage.\n\nContinue anyway?`,
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => resolve(false),
              },
              {
                text: "Continue Anyway",
                style: "destructive",
                onPress: () => resolve(true),
              },
            ],
            { cancelable: false },
          );
        });

        if (!proceed) {
          addLog("Download cancelled — insufficient storage.", "warning");
          return;
        }
        addLog(
          `Proceeding with low storage (${freeMB}MB free). Download may fail if space runs out.`,
          "warning",
        );
      }
    } catch (err) {
      // If the storage check itself fails, don't block the user — just skip the warning.
      console.warn("Storage check failed:", err);
    }

    const engineUi: AddEngineUi = {
      stopRef,
      addLog,
      clearLogs: () => setLogs([]),
      setIsDownloading,
      setProgress,
      setProgressLabel,
      startTimer,
      stopTimer,
      addNovel,
      onDuplicate: (title, chapterCount) => {
        Alert.alert(
          "📚 Novel Already Exists",
          `"${title}" is already in your library with ${chapterCount} chapters.\n\nYou can update it from the Updates tab if needed.`,
          [
            {
              text: "OK",
              onPress: () => {
                setUrl("");
                setProgress(0);
              },
            },
            {
              text: "Go to Updates",
              onPress: () => {
                setUrl("");
                setProgress(0);
                router.push("/(tabs)/updates");
              },
            },
          ],
        );
      },
    };
    await runAddDownload(
      { trimmedUrl, startChStr, maxChStr, novels },
      engineUi,
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
        <Ionicons name="cloud-download" size={22} color={colors.accent} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Download Novel
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad + 20 },
        ]}
        showsVerticalScrollIndicator={true}
        alwaysBounceVertical={true}
      >
        {/* Supported Sites Section */}
        <View style={styles.sitesSection}>
          <View style={styles.sitesHeader}>
            <Ionicons name="globe" size={16} color={colors.accent} />
            <Text
              style={[styles.sitesHeaderLabel, { color: colors.textSecondary }]}
            >
              SUPPORTED SITES
            </Text>
            {isCheckingSites && (
              <ActivityIndicator
                size="small"
                color={colors.accent}
                style={{ marginLeft: "auto" }}
              />
            )}
          </View>

          {/* Legend */}
          <View style={styles.legendContainer}>
            <View style={styles.legendItem}>
              <Text>🟢</Text>
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                UP
              </Text>
            </View>
            <View style={styles.legendSeparator}>
              <Text style={{ color: colors.textSecondary }}>|</Text>
            </View>
            <View style={styles.legendItem}>
              <Text>🔴</Text>
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                DOWN
              </Text>
            </View>
            <View style={styles.legendSeparator}>
              <Text style={{ color: colors.textSecondary }}>|</Text>
            </View>
            <View style={styles.legendItem}>
              <Text>🟡</Text>
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                MAINT.
              </Text>
            </View>
          </View>

          <View style={styles.langSummaryRow}>
            {langSummary.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => openSourceList(item.key)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${LANG_LABEL[item.key]} sites`}
                style={({ pressed }) => [
                  styles.langSummaryPill,
                  {
                    backgroundColor: item.color
                      ? item.color + "1A"
                      : colors.card,
                    borderColor: item.color ?? colors.border,
                    borderWidth: item.color ? 1.5 : 1,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.langSummaryText, { color: colors.text }]}
                >
                  {LANG_LABEL[item.key]}: {item.up}/{item.total}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.textMuted}
                />
              </Pressable>
            ))}
          </View>

          <Text style={[styles.legendSubtitle, { color: colors.textMuted }]}>
            Tap a group to see its sites. *Downed source more than a month will
            be removed
          </Text>
        </View>

        {/* Form Section */}
        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Novel URL
            </Text>
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
                Start Chapter{isChapterUrl ? " 🔗" : ""}
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
                editable={!isDownloading}
              />
            </View>
          </View>

          <View style={styles.buttons}>
            <Pressable
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: isDownloading
                    ? colors.border
                    : colors.accent,
                },
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
                onPress={halt.press}
                disabled={halt.disabled}
              >
                <Ionicons name="stop" size={16} color={Colors.error} />
                <Text style={[styles.outlineBtnText, { color: Colors.error }]}>
                  {halt.label}
                </Text>
              </Pressable>
            )}

            {!isDownloading && (
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

        {/* Progress Section */}
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Ionicons name="bar-chart" size={15} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Progress
            </Text>
            {progressLabel ? (
              <Text
                style={[styles.progressLabel, { color: colors.textSecondary }]}
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

        {/* Elapsed Time Section */}
        {(isDownloading || elapsedTime !== "00:00:00") && (
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

        {/* Activity Log Section */}
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
                Ready to download...
              </Text>
            ) : (
              logs.map((entry) => <LogLine key={entry.id} entry={entry} />)
            )}
          </ScrollView>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Source List Modal */}
      <SourceListModal
        visible={sourceListModalVisible}
        onClose={() => setSourceListModalVisible(false)}
        sites={SUPPORTED_SITES}
        siteStatuses={siteStatuses}
        deprecatedSites={DEPRECATED_SITES}
        langFilter={sourceListLang}
        onLangFilterChange={setSourceListLang}
      />

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
    marginBottom: 6,
  },
  sitesHeaderLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
  },
  legendContainer: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  legendSeparator: {
    marginHorizontal: 2,
  },
  legendSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    fontStyle: "italic",
    marginBottom: 8,
  },
  sitesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 8,
  },
  lowModeBadge: {
    borderWidth: 1.5,
    borderColor: Colors.amber,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  lowModeBadgeText: { fontSize: 12, fontWeight: "700", color: Colors.amber },
  recheckButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  scrollBox: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 8 },
  sourceCloseButton: {
    marginTop: 12,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceCloseText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  rowList: { gap: 6, paddingTop: 8, paddingBottom: 8 },
  rowCell: {
    height: 34,
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowName: { fontSize: 14, fontWeight: "600", flexShrink: 1, marginRight: 10 },
  rowStatus: { fontSize: 12, fontWeight: "700" },
  siteCell: {
    width: "48%",
    height: 56,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 2,
  },
  siteName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textAlign: "center",
    width: "100%",
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
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "75%",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  modalTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    textAlign: "center",
  },
  modalSeparator: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
    marginTop: 14,
    marginBottom: 16,
  },
  gridRow: {
    gap: 8,
    justifyContent: "space-between",
  },
  gridContent: {
    paddingBottom: 10,
  },
  modalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-start",
    paddingBottom: 10,
  },
  langPillRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 8,
  },
  langPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 2,
  },
  langPillText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  langEmpty: {
    width: "100%",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    paddingVertical: 12,
  },
  langSummaryRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
    marginBottom: 8,
  },
  langSummaryPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  langSummaryText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sectionContainer: {
    width: "100%",
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  sitesList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  deprecatedSection: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  deprecatedList: {
    gap: 8,
  },
  deprecatedItem: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    width: "100%",
  },
  deprecatedItemName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  deprecatedItemReason: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 4,
  },
  tabNavigation: {
    flexDirection: "row",
    marginBottom: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    alignItems: "center",
  },
  tabButtonActive: {
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  deprecatedTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    marginBottom: 12,
  },
  deprecatedPillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-start",
  },
  deprecatedPillContainer: {
    flex: 1,
    minWidth: "48%",
  },
  deprecatedPillDomain: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    marginBottom: 2,
  },
  deprecatedPillSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
});
