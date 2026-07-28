import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

const BULK_DELETE_LOADING_THRESHOLD = 1;

// Export format types
type ExportFormat = "txt" | "epub" | "docx" | "rtf" | "mobi" | "pdf";

// Export options configuration
const EXPORT_OPTIONS: {
  format: ExportFormat;
  label: string;
  icon: string;
  color: string;
}[] = [
  {
    format: "txt",
    label: "Plain Text (.txt)",
    icon: "document-text-outline",
    color: "#4A90E2",
  },
  {
    format: "epub",
    label: "EPUB (.epub)",
    icon: "book-outline",
    color: "#27AE60",
  },
  {
    format: "pdf",
    label: "PDF Letter (.pdf)",
    icon: "document-outline",
    color: "#FF4444",
  },
  {
    format: "docx",
    label: "Word Document (.docx)",
    icon: "document-outline",
    color: "#2B579A",
  },
  {
    format: "rtf",
    label: "Rich Text (.rtf)",
    icon: "text-outline",
    color: "#E67E22",
  },
  {
    format: "mobi",
    label: "Kindle (.mobi)",
    icon: "tablet-portrait-outline",
    color: "#8E44AD",
  },
];

// ── Export Functions ────────────────────────────────────────────────────────

async function loadFullNovelContent(
  novelId: string,
  chapters: { title: string; url: string; content?: string }[],
): Promise<{ title: string; content: string }[]> {
  const chaptersDir = `${FileSystem.documentDirectory}NovelDR/chapters/${novelId}/`;

  // ── Helper: Check if content has enough words to be real ─────────
  const hasRealContent = (text: string | null | undefined): boolean => {
    if (!text || !text.trim()) return false;
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount >= 100; // At least 100 words to be considered real content
  };

  // ── DEDUPLICATE: Keep only one entry per chapter number, prefer ones with real content ─
  const seenNumbers = new Map<
    number,
    { title: string; url: string; content?: string }
  >();

  for (const ch of chapters) {
    const num = extractChapterNumber(ch.title, ch.url);
    const existing = seenNumbers.get(num);

    if (
      !existing ||
      (hasRealContent(ch.content) && !hasRealContent(existing.content))
    ) {
      seenNumbers.set(num, { ...ch });
    }
  }

  // Sort by chapter number
  const sortedChapters = Array.from(seenNumbers.values()).sort((a, b) => {
    const numA = extractChapterNumber(a.title, a.url);
    const numB = extractChapterNumber(b.title, b.url);
    return numA - numB;
  });

  const result: { title: string; content: string }[] = [];

  // Pre-load AsyncStorage data once
  let legacyNovel: any = null;
  try {
    const libraryData = await AsyncStorage.getItem("novel_library_v1");
    if (libraryData) {
      const novels = JSON.parse(libraryData);
      legacyNovel = novels.find((n: any) => n.id === novelId);
    }
  } catch {}

  for (let i = 0; i < sortedChapters.length; i++) {
    const ch = sortedChapters[i];
    let title = ch.title || `Chapter ${i + 1}`;
    let content: string | null = null;

    // Check file system
    try {
      const chapterPath = `${chaptersDir}chapter_${i}.json`;
      const fileInfo = await FileSystem.getInfoAsync(chapterPath);
      if (fileInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(chapterPath);
        const chapterData = JSON.parse(raw);
        if (hasRealContent(chapterData.content)) {
          content = chapterData.content;
          if (chapterData.title) title = chapterData.title;
        }
      }
    } catch {}

    // Fallback to AsyncStorage (only if real content exists)
    if (!content && legacyNovel?.chapters) {
      const urlMatch = legacyNovel.chapters.find(
        (lc: any) => lc.url === ch.url && hasRealContent(lc.content),
      );
      if (urlMatch) {
        content = urlMatch.content;
        if (urlMatch.title) title = urlMatch.title;
      }
    }

    // Fallback to in-memory
    if (!content && hasRealContent(ch.content)) {
      content = ch.content ?? null;
    }

    result.push({
      title,
      content:
        content ||
        `[Content not available for this chapter. Open it in the reader first to migrate the data.]`,
    });
  }

  return result;
}

// Helper to extract chapter number
function extractChapterNumber(title: string, url: string): number {
  const titleMatch = (title || "").match(/chapter\s*(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1]);
  const urlMatch = (url || "").match(/chapter[-/](\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1]);
  return 9999;
}

function generateTXT(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): string {
  let txt = `${novelTitle}\n`;
  txt += `by ${author}\n`;
  txt += `${"=".repeat(50)}\n\n`;

  for (const ch of chapters) {
    txt += `${ch.title}\n`;
    txt += `${"-".repeat(30)}\n\n`;
    txt += `${ch.content}\n\n\n`;
  }

  return txt;
}

function generateEPUB(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): string {
  let epub = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  epub += `<!DOCTYPE html>\n`;
  epub += `<html xmlns="http://www.w3.org/1999/xhtml">\n`;
  epub += `<head><title>${escapeXML(novelTitle)}</title>\n`;
  epub += `<style>body { font-family: serif; line-height: 1.6; } p { margin: 0 0 0.5em 0; }</style></head>\n`;
  epub += `<body>\n`;
  epub += `<h1>${escapeXML(novelTitle)}</h1>\n`;
  epub += `<p><em>by ${escapeXML(author)}</em></p>\n`;
  epub += `<hr/>\n`;

  for (const ch of chapters) {
    epub += `<h2>${escapeXML(ch.title)}</h2>\n`;
    const paragraphs = ch.content.split(/\n\n+/);
    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        const formatted = paragraph.trim().replace(/\n/g, "<br/>\n");
        epub += `<p>${escapeXMLContent(formatted)}</p>\n`;
      }
    }
    epub += `<hr/>\n`;
  }

  epub += `</body></html>`;
  return epub;
}

async function generatePDF(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): Promise<string> {
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: letter; margin: 1in; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
    }
    .title-page {
      text-align: center;
      padding-top: 3in;
      page-break-after: always;
    }
    .title-page h1 { font-size: 24pt; margin-bottom: 12pt; }
    .title-page p { font-size: 14pt; color: #555; }
    .chapter-title {
      font-size: 16pt;
      font-weight: bold;
      margin-top: 24pt;
      margin-bottom: 12pt;
      page-break-before: always;
      text-align: center;
    }
    .chapter-content {
      text-align: justify;
      white-space: pre-wrap;
    }
    .footer {
      text-align: center;
      font-size: 9pt;
      color: #999;
      margin-top: 24pt;
    }
  </style>
</head>
<body>
  <div class="title-page">
    <h1>${escapeXML(novelTitle)}</h1>
    <p>by ${escapeXML(author)}</p>
    <p style="margin-top: 2in; font-size: 10pt; color: #999;">Generated by Novel DR</p>
  </div>
`;

  for (const ch of chapters) {
    html += `  <div class="chapter-title">${escapeXML(ch.title)}</div>
  <div class="chapter-content">${escapeXML(ch.content)}</div>
`;
  }

  html += `  <div class="footer">
    <p>End of ${escapeXML(novelTitle)}</p>
  </div>
</body>
</html>`;

  const { uri } = await Print.printToFileAsync({
    html,
    width: 612,
    height: 792,
    margins: { left: 72, right: 72, top: 72, bottom: 72 },
  });

  return uri;
}

function generateDOCX(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): string {
  let docx = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n`;
  docx += `<head><meta charset="UTF-8"/><title>${escapeXML(novelTitle)}</title>\n`;
  docx += `<style>body { font-family: 'Times New Roman', serif; line-height: 1.5; } p { margin: 0 0 6pt 0; }</style></head>\n`;
  docx += `<body>\n`;
  docx += `<h1>${escapeXML(novelTitle)}</h1>\n`;
  docx += `<p><strong>by ${escapeXML(author)}</strong></p>\n`;
  docx += `<hr/>\n`;

  for (const ch of chapters) {
    docx += `<h2>${escapeXML(ch.title)}</h2>\n`;
    const paragraphs = ch.content.split(/\n\n+/);
    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        const formatted = paragraph.trim().replace(/\n/g, "<br/>\n");
        docx += `<p>${escapeXMLContent(formatted)}</p>\n`;
      }
    }
    docx += `<br/>\n`;
  }

  docx += `</body></html>`;
  return docx;
}

function generateRTF(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): string {
  let rtf = `{\\rtf1\\ansi\\deff0\n`;
  rtf += `{\\fonttbl{\\f0 Times New Roman;}}\n`;
  rtf += `\\f0\\fs24\n`;
  rtf += `{\\b ${escapeRTF(novelTitle)}}\\par\n`;
  rtf += `${escapeRTF(author)}\\par\\par\n`;

  for (const ch of chapters) {
    rtf += `{\\b ${escapeRTF(ch.title)}}\\par\n`;
    rtf += `${escapeRTF(ch.content).replace(/\n/g, "\\par ")}`;
    rtf += `\\par\\par\n`;
  }

  rtf += `}`;
  return rtf;
}

function generateMOBI(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): string {
  return generateEPUB(novelTitle, author, chapters);
}

function escapeXML(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function escapeXMLContent(str: string): string {
  const brPlaceholder = "___BR_PLACEHOLDER___";
  const withProtected = str.replace(/<br\/>/g, brPlaceholder);
  const escaped = escapeXML(withProtected);
  return escaped.replace(new RegExp(brPlaceholder, "g"), "<br/>");
}

function escapeRTF(str: string): string {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\par ");
}

const generators: Record<
  ExportFormat,
  (
    title: string,
    author: string,
    chapters: { title: string; content: string }[],
  ) => string | Promise<string>
> = {
  txt: generateTXT,
  epub: generateEPUB,
  pdf: generatePDF,
  docx: generateDOCX,
  rtf: generateRTF,
  mobi: generateMOBI,
};

const extensions: Record<ExportFormat, string> = {
  txt: ".txt",
  epub: ".epub",
  pdf: ".pdf",
  docx: ".doc",
  rtf: ".rtf",
  mobi: ".mobi",
};

const mimeTypes: Record<ExportFormat, string> = {
  txt: "text/plain",
  epub: "application/epub+zip",
  pdf: "application/pdf",
  docx: "application/msword",
  rtf: "application/rtf",
  mobi: "application/x-mobipocket-ebook",
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function NovelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    getNovel,
    sortOrder,
    toggleSortOrder,
    getSortedChapters,
    deleteChapters,
  } = useLibrary();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [chapterSelectionMode, setChapterSelectionMode] = useState(false);
  const [selectedChapterUrls, setSelectedChapterUrls] = useState<string[]>([]);
  const [confirmDeleteChaptersVisible, setConfirmDeleteChaptersVisible] =
    useState(false);
  const [chapterListRefreshKey, setChapterListRefreshKey] = useState(0);
  const [deletingChapters, setDeletingChapters] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });

  const novel = getNovel(id);

  // ── Hooks below must run unconditionally on every render, so they're
  // declared before the early "novel not found" return. They no-op via
  // optional chaining when `novel` is undefined; in that case the FlatList
  // that would use them is never rendered anyway (see early return below).
  const renderChapterItem = useCallback(
    ({
      item: ch,
      index: i,
    }: {
      item: NonNullable<typeof novel>["chapters"][number];
      index: number;
    }) => {
      const originalIndex =
        novel?.chapters.findIndex((c) => c.url === ch.url) ?? -1;
      const isCurrent = novel?.lastRead?.chapterIndex === originalIndex;
      const isSelected = selectedChapterUrls.includes(ch.url);
      return (
        <Pressable
          style={[
            styles.chapterRow,
            chapterSelectionMode
              ? {
                  backgroundColor: isSelected
                    ? colors.accent + "20"
                    : colors.card,
                  borderColor: isSelected ? colors.accent : colors.border,
                }
              : {
                  backgroundColor: isCurrent
                    ? colors.accent + "18"
                    : colors.card,
                  borderColor: isCurrent ? colors.accent : colors.border,
                },
          ]}
          onPress={() => {
            if (chapterSelectionMode) {
              toggleChapterSelection(ch.url);
              return;
            }
            Haptics.selectionAsync();
            router.push({
              pathname: "/reader/[id]",
              params: { id: novel?.id, chapterIndex: originalIndex.toString() },
            });
          }}
          onLongPress={() => {
            if (chapterSelectionMode) {
              toggleChapterSelection(ch.url);
            } else {
              enterChapterSelectionMode(ch.url);
            }
          }}
        >
          <Text
            style={[
              styles.chapterTitle,
              {
                color:
                  isCurrent && !chapterSelectionMode
                    ? colors.accent
                    : colors.text,
              },
            ]}
            numberOfLines={1}
          >
            {isCurrent && !chapterSelectionMode ? "► " : ""}
            {ch.title}
          </Text>
          {!chapterSelectionMode && (
            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.textMuted}
            />
          )}
        </Pressable>
      );
    },
    [
      novel?.chapters,
      novel?.lastRead?.chapterIndex,
      novel?.id,
      colors.accent,
      colors.text,
      colors.card,
      colors.border,
      colors.textMuted,
      chapterSelectionMode,
      selectedChapterUrls,
    ],
  );

  const keyExtractor = useCallback(
    (item: NonNullable<typeof novel>["chapters"][number], index: number) => {
      return `${item.url}-${index}`;
    },
    [],
  );

  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 48,
      offset: 48 * index,
      index,
    }),
    [],
  );

  if (!novel) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Novel not found</Text>
      </View>
    );
  }

  const sortedChapters = getSortedChapters(novel.chapters);

  const progress = novel.lastRead
    ? `${novel.lastRead.chapterIndex + 1} / ${novel.chapters.length}`
    : `0 / ${novel.chapters.length}`;
  const progressPct = novel.lastRead
    ? (novel.lastRead.chapterIndex + 1) / Math.max(novel.chapters.length, 1)
    : 0;

  const firstParagraph =
    novel.synopsis.split("\n\n")[0] || novel.synopsis.slice(0, 200);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ── Export Handler ──────────────────────────────────────────────────────
  const handleExport = async (format: ExportFormat) => {
    setShowExportModal(false);
    setShowMenu(false);
    setExporting(true);
    setExportProgress("Loading chapters...");

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const chapters = await loadFullNovelContent(novel.id, novel.chapters);

      setExportProgress("Generating file...");

      const generator = generators[format];
      const content = await generator(novel.title, novel.author, chapters);

      const exportDir = `${FileSystem.documentDirectory}exports/`;
      const dirInfo = await FileSystem.getInfoAsync(exportDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });
      }

      const safeTitle = novel.title
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 50);
      const filename = `${safeTitle}${extensions[format]}`;
      const filePath = `${exportDir}${filename}`;

      if (format === "pdf") {
        await FileSystem.copyAsync({ from: content as string, to: filePath });
      } else {
        await FileSystem.writeAsStringAsync(filePath, content as string, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      setExportProgress("Opening share dialog...");

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: mimeTypes[format],
          dialogTitle: `Export ${novel.title}`,
        });
      } else {
        Alert.alert("Export Complete", `File saved to:\n${filename}`);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert(
        "Export Failed",
        error.message || "An error occurred during export.",
      );
    } finally {
      setExporting(false);
      setExportProgress("");
    }
  };

  // ── Chapter selection / delete ─────────────────────────────────────────
  const enterChapterSelectionMode = (firstUrl?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChapterSelectionMode(true);
    setSelectedChapterUrls(firstUrl ? [firstUrl] : []);
  };

  const exitChapterSelectionMode = () => {
    setChapterSelectionMode(false);
    setSelectedChapterUrls([]);
  };

  const toggleChapterSelection = (url: string) => {
    Haptics.selectionAsync();
    setSelectedChapterUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const showFirstDeleteConfirmation = () => {
    if (selectedChapterUrls.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Confirm Deletion",
      `Delete ${selectedChapterUrls.length} chapter${selectedChapterUrls.length !== 1 ? "s" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => setConfirmDeleteChaptersVisible(true),
        },
      ],
    );
  };

  const performChapterDelete = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmDeleteChaptersVisible(false);

    const showLoadingModal =
      selectedChapterUrls.length > BULK_DELETE_LOADING_THRESHOLD;
    const survivorCount = novel.chapters.length - selectedChapterUrls.length;
    if (showLoadingModal) {
      setDeleteProgress({ done: 0, total: survivorCount });
      setDeletingChapters(true);
    }

    try {
      await deleteChapters(novel.id, selectedChapterUrls, (done, total) => {
        setDeleteProgress({ done, total });
      });
      setChapterSelectionMode(false);
      setSelectedChapterUrls([]);
      // Force a full remount of the chapter FlatList — getNovel(id) already
      // returns the updated chapters array on the next render, but the list
      // doesn't always visually reflect it until something else (like
      // navigating away and back) triggers a fresh mount. Bumping the `key`
      // prop below guarantees the list actually redraws immediately.
      setChapterListRefreshKey((k) => k + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      if (showLoadingModal) setDeletingChapters(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {chapterSelectionMode ? (
        <View
          style={[
            styles.navBar,
            { paddingTop: topPad + 4, borderBottomColor: colors.border },
          ]}
        >
          <Pressable style={styles.backBtn} onPress={exitChapterSelectionMode}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text
            style={[styles.navTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            Selected: {selectedChapterUrls.length}
          </Text>
          {selectedChapterUrls.length > 0 ? (
            <Pressable
              style={styles.menuBtn}
              onPress={showFirstDeleteConfirmation}
            >
              <Ionicons name="trash-outline" size={22} color={colors.text} />
            </Pressable>
          ) : (
            <View style={styles.menuBtn} />
          )}
        </View>
      ) : (
        <View
          style={[
            styles.navBar,
            { paddingTop: topPad + 4, borderBottomColor: colors.border },
          ]}
        >
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
            <Text style={[styles.backLabel, { color: colors.accent }]}>
              Library
            </Text>
          </Pressable>
          <Text
            style={[styles.navTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {novel.title}
          </Text>
          <Pressable
            style={styles.menuBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowMenu(true);
            }}
          >
            <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
          </Pressable>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
        nestedScrollEnabled={true}
      >
        <View style={styles.hero}>
          <View style={styles.coverWrap}>
            {novel.coverUrl ? (
              <Image
                source={{ uri: novel.coverUrl }}
                style={styles.cover}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.coverPlaceholder,
                  { backgroundColor: colors.card },
                ]}
              >
                <Ionicons name="book" size={48} color={colors.accent} />
              </View>
            )}
          </View>
          <View style={styles.heroInfo}>
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              {novel.title}
            </Text>
            <Text style={[styles.heroAuthor, { color: colors.textSecondary }]}>
              {novel.author}
            </Text>

            <View style={styles.heroButtons}>
              <Pressable
                style={[styles.readBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  const startIndex = novel.lastRead?.chapterIndex ?? 0;
                  router.push({
                    pathname: "/reader/[id]",
                    params: {
                      id: novel.id,
                      chapterIndex: startIndex.toString(),
                    },
                  });
                }}
              >
                <Ionicons
                  name={novel.lastRead ? "play" : "book-outline"}
                  size={16}
                  color="#fff"
                />
                <Text style={styles.readBtnText}>
                  {novel.lastRead ? "Continue" : "Start Reading"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          {novel.lastRead && (
            <View
              style={[
                styles.progressCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.progressTop}>
                <Text style={[styles.progressLabel, { color: colors.text }]}>
                  Reading Progress
                </Text>
                <Text style={[styles.progressCount, { color: colors.accent }]}>
                  {progress}
                </Text>
              </View>
              <View
                style={[styles.progressBar, { backgroundColor: colors.border }]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.accent,
                      width: `${progressPct * 100}%`,
                    },
                  ]}
                />
              </View>
              <Text
                style={[styles.lastReadLabel, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                Last: {novel.lastRead.chapterTitle}
              </Text>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Synopsis
          </Text>
          <Pressable
            style={[
              styles.synopsisCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => setSynopsisExpanded((e) => !e)}
          >
            <Text
              style={[styles.synopsisText, { color: colors.textSecondary }]}
            >
              {synopsisExpanded ? novel.synopsis : firstParagraph}
              {!synopsisExpanded &&
              novel.synopsis.length > firstParagraph.length
                ? "..."
                : ""}
            </Text>
            <View style={styles.seeMoreRow}>
              <Text style={[styles.seeMore, { color: colors.accent }]}>
                {synopsisExpanded ? "See Less" : "See More"}
              </Text>
              <Ionicons
                name={synopsisExpanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.accent}
              />
            </View>
          </Pressable>

          <View style={styles.chapterHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Chapters ({novel.chapters.length})
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={toggleSortOrder}
                style={[styles.sortBtn, { borderColor: colors.border }]}
              >
                <Ionicons
                  name={sortOrder === "ascending" ? "arrow-up" : "arrow-down"}
                  size={16}
                  color={colors.accent}
                />
                <Text style={[styles.sortBtnText, { color: colors.accent }]}>
                  {sortOrder === "ascending" ? "Asc" : "Desc"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => enterChapterSelectionMode()}
                style={[
                  styles.sortBtn,
                  styles.deleteChaptersBtn,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.chapterListContainer}>
            <FlatList
              key={chapterListRefreshKey}
              data={sortedChapters}
              extraData={[chapterSelectionMode, selectedChapterUrls]}
              keyExtractor={keyExtractor}
              renderItem={renderChapterItem}
              getItemLayout={getItemLayout}
              scrollEnabled={false}
              nestedScrollEnabled={true}
              initialNumToRender={20}
              maxToRenderPerBatch={30}
              windowSize={10}
              removeClippedSubviews={true}
              ListEmptyComponent={
                <View style={styles.emptyChapters}>
                  <Ionicons
                    name="document-text-outline"
                    size={32}
                    color={colors.textSecondary}
                    style={styles.emptyChaptersIcon}
                  />
                  <Text style={[styles.emptyText, { color: colors.text }]}>
                    No chapters yet
                  </Text>
                  <Text
                    style={[
                      styles.emptyTextSub,
                      { color: colors.textSecondary },
                    ]}
                  >
                    This novel hasn&apos;t downloaded any chapters. Check the
                    Updates tab to fetch the latest ones.
                  </Text>
                  <Pressable
                    style={[
                      styles.emptyChaptersBtn,
                      { backgroundColor: colors.accent },
                    ]}
                    onPress={() => router.push("/(tabs)/updates")}
                  >
                    <Ionicons name="refresh" size={16} color="#fff" />
                    <Text style={styles.emptyChaptersBtnText}>
                      Go to Updates
                    </Text>
                  </Pressable>
                </View>
              }
            />
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setShowMenu(false)}
        >
          <View
            style={[
              styles.menuContainer,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: bottomPad + 20,
              },
            ]}
          >
            <Text
              style={[styles.menuTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {novel.title}
            </Text>
            <Pressable
              style={[styles.menuItem, { borderColor: colors.border }]}
              onPress={() => {
                setShowMenu(false);
                setShowExportModal(true);
              }}
            >
              <Ionicons
                name="download-outline"
                size={20}
                color={colors.accent}
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                Export Novel
              </Text>
            </Pressable>
            <Pressable
              style={[styles.menuItem, { borderColor: colors.border }]}
              onPress={() => setShowMenu(false)}
            >
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={colors.textSecondary}
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                Novel Info
              </Text>
            </Pressable>
            <Pressable
              style={[styles.menuCancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowMenu(false)}
            >
              <Text
                style={[styles.menuCancelText, { color: colors.textSecondary }]}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showExportModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportModal(false)}
      >
        <Pressable
          style={[styles.menuOverlay, styles.centerOverlay]}
          onPress={() => setShowExportModal(false)}
        >
          <View
            style={[
              styles.exportModalContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.menuTitle, { color: colors.text }]}>
              Export as...
            </Text>
            {EXPORT_OPTIONS.map((option) => (
              <Pressable
                key={option.format}
                style={[styles.exportItem, { borderColor: colors.border }]}
                onPress={() => handleExport(option.format)}
              >
                <Ionicons
                  name={option.icon as any}
                  size={20}
                  color={option.color}
                />
                <Text style={[styles.menuItemText, { color: colors.text }]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.menuCancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowExportModal(false)}
            >
              <Text
                style={[styles.menuCancelText, { color: colors.textSecondary }]}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={exporting} transparent animationType="fade">
        <View style={styles.menuOverlay}>
          <View
            style={[styles.progressModal, { backgroundColor: colors.card }]}
          >
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.progressText, { color: colors.text }]}>
              {exportProgress}
            </Text>
            <Text
              style={[styles.progressSubText, { color: colors.textSecondary }]}
            >
              This may take a moment for large novels...
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={confirmDeleteChaptersVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDeleteChaptersVisible(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View
            style={[
              styles.confirmModalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <Ionicons
              name="alert-circle"
              size={48}
              color={colors.text}
              style={styles.confirmModalIcon}
            />
            <Text style={[styles.confirmModalTitle, { color: colors.text }]}>
              Confirm Deletion
            </Text>
            <Text
              style={[
                styles.confirmModalMessage,
                { color: colors.textSecondary },
              ]}
            >
              This will permanently delete {selectedChapterUrls.length} chapter
              {selectedChapterUrls.length !== 1 ? "s" : ""}.{"\n\n"}
              Are you sure about this? {"\n\n"}
              If YES, click the &apos;DELETE&apos; button.
            </Text>

            <View style={styles.confirmModalButtons}>
              <Pressable
                style={[
                  styles.confirmModalButton,
                  styles.confirmModalCancelButton,
                  { borderColor: colors.border },
                ]}
                onPress={() => setConfirmDeleteChaptersVisible(false)}
              >
                <Text
                  style={[
                    styles.confirmModalButtonText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmModalButton,
                  styles.confirmModalDeleteButton,
                ]}
                onPress={performChapterDelete}
              >
                <Text
                  style={[styles.confirmModalButtonText, { color: "#fff" }]}
                >
                  DELETE
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={deletingChapters} transparent animationType="fade">
        <View style={styles.menuOverlay}>
          <View
            style={[styles.progressModal, { backgroundColor: colors.card }]}
          >
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.progressText, { color: colors.text }]}>
              Please Wait
            </Text>
            <Text
              style={[styles.progressSubText, { color: colors.textSecondary }]}
            >
              {deleteProgress.total > 0
                ? `${deleteProgress.done} / ${deleteProgress.total}`
                : ""}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 70,
  },
  backLabel: { fontFamily: "Inter_500Medium", fontSize: 15 },
  navTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    flex: 1,
    textAlign: "center",
  },
  menuBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    flexDirection: "row",
    padding: 20,
    gap: 16,
    alignItems: "flex-start",
  },
  coverWrap: {
    width: 100,
    height: 140,
    borderRadius: 12,
    overflow: "hidden",
    flexShrink: 0,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  heroInfo: { flex: 1, gap: 6 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 17, lineHeight: 24 },
  heroAuthor: { fontFamily: "Inter_400Regular", fontSize: 13 },
  heroButtons: { marginTop: 10 },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  readBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  content: { paddingHorizontal: 16, gap: 12 },
  progressCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  progressTop: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontFamily: "Inter_500Medium", fontSize: 13 },
  progressCount: { fontFamily: "Inter_700Bold", fontSize: 13 },
  progressBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  lastReadLabel: { fontFamily: "Inter_400Regular", fontSize: 12 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  synopsisCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  synopsisText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
  },
  seeMoreRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeMore: { fontFamily: "Inter_500Medium", fontSize: 13 },
  chapterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sortBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  deleteChaptersBtn: { paddingHorizontal: 8 },
  chapterListContainer: { minHeight: 200 },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  chapterTitle: { fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 },
  emptyChapters: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyChaptersIcon: {
    marginBottom: 10,
    opacity: 0.7,
  },
  emptyText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 4,
  },
  emptyTextSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 14,
    maxWidth: 260,
  },
  emptyChaptersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  emptyChaptersBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#fff",
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  centerOverlay: { justifyContent: "center", alignItems: "center" },
  menuContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 4,
  },
  menuTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    marginBottom: 12,
    textAlign: "center",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  menuCancelBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  menuCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  exportContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 4,
    maxHeight: "70%",
  },
  exportModalContainer: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 4,
    width: "85%",
    maxWidth: 380,
    maxHeight: "80%",
  },
  exportItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  progressModal: {
    marginHorizontal: 40,
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    gap: 12,
    alignSelf: "center",
    marginTop: "auto",
    marginBottom: "auto",
  },
  progressText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    textAlign: "center",
  },
  progressSubText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  confirmModalContent: {
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: 8,
  },
  confirmModalIcon: { marginBottom: 4 },
  confirmModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  confirmModalMessage: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  confirmModalButtons: { flexDirection: "row", gap: 10, width: "100%" },
  confirmModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmModalCancelButton: { borderWidth: 1 },
  confirmModalDeleteButton: { backgroundColor: "#ff4444" },
  confirmModalButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
