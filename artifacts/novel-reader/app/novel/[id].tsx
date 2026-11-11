import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadExportChapters } from "../../lib/exportChapters";
import { buildEpubFiles } from "../../lib/ebook/epub";
import { buildDocxFiles } from "../../lib/ebook/docx";
import { zipToBase64, zipFilesToBase64 } from "../../lib/ebook/package";
import { coverFromFileName, MAX_COVER_BYTES } from "../../lib/ebook/epubCover";
import { escapeRTF } from "../../lib/rtf";
import { LONG_NOVEL_CHAPTERS } from "../../lib/exportPlan";
import { runLongNovelExport, type LongFormat } from "../../lib/longExport";
import { createDeviceAdapters } from "../../lib/exportDevice";
import { exportLongPdf } from "../../lib/pdfExport";
import {
  ExportProgressCard,
  type TimedEvent,
} from "../../components/ExportProgressCard";
import type { ExportProgress } from "../../lib/exportRunner";
import { filterChaptersByTitle } from "../../lib/chapterSearch";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

const BULK_DELETE_LOADING_THRESHOLD = 3;

// Export format types
type ExportFormat = "txt" | "epub" | "docx" | "rtf" | "pdf";

// Formats written as base64 (ZIP packages). All others are written as UTF-8 text.
const BINARY_FORMATS: ExportFormat[] = ["epub", "docx"];

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
];

// ── Export Functions ────────────────────────────────────────────────────────

async function loadFullNovelContent(
  novelId: string,
  chapters: { title: string; url: string; content?: string }[],
): Promise<{ title: string; content: string }[]> {
  const chaptersDir = `${FileSystem.documentDirectory}NovelDR/chapters/${novelId}/`;

  // Legacy AsyncStorage copy, read once. Used only when a chapter file is absent.
  let legacyNovel: any = null;
  try {
    const libraryData = await AsyncStorage.getItem("novel_library_v1");
    if (libraryData) {
      const novels = JSON.parse(libraryData);
      legacyNovel = novels.find((n: any) => n.id === novelId);
    }
  } catch {}

  // Chapter files are stored by position in novel.chapters. The loader passes
  // each chapter's original index, so the right file is always read.
  const readStoredFile = async (index: number) => {
    try {
      const chapterPath = `${chaptersDir}chapter_${index}.json`;
      const fileInfo = await FileSystem.getInfoAsync(chapterPath);
      if (!fileInfo.exists) return null;
      const raw = await FileSystem.readAsStringAsync(chapterPath);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const readLegacyContent = async (url: string) =>
    legacyNovel?.chapters?.find((lc: any) => lc.url === url) ?? null;

  const { chapters: exported } = await loadExportChapters(
    chapters,
    readStoredFile,
    readLegacyContent,
  );
  return exported;
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

// Reads the novel's local cover for EPUB. Remote covers are intentionally
// skipped so exports remain available offline.
async function readEpubCover(coverUri?: string) {
  if (!coverUri || !coverUri.startsWith("file://")) return null;
  const file = coverFromFileName(coverUri.split("/").pop() ?? "");
  if (!file) return null;
  const info = await FileSystem.getInfoAsync(coverUri);
  if (!info.exists || info.isDirectory) return null;
  if (((info as { size?: number }).size ?? 0) > MAX_COVER_BYTES) return null;
  const base64 = await FileSystem.readAsStringAsync(coverUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { file, base64 };
}

// Real EPUB 3 package: a ZIP with mimetype, container, OPF, nav, NCX, XHTML,
// and (when available) the novel's local cover image.
async function generateEPUB(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
  novelId: string,
  coverUri?: string,
): Promise<string> {
  const cover = await readEpubCover(coverUri);
  const files = buildEpubFiles(
    { id: novelId, title: novelTitle, author },
    chapters,
    cover?.file,
  );
  const binaryPaths = new Set<string>();
  if (cover) {
    const coverEntry = `OEBPS/${cover.file.fileName}`;
    files[coverEntry] = cover.base64;
    binaryPaths.add(coverEntry);
  }
  return zipFilesToBase64(files, "application/epub+zip", binaryPaths);
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

// Real Word (OOXML) package: a ZIP with document, styles, and core properties.
async function generateDOCX(
  novelTitle: string,
  author: string,
  chapters: { title: string; content: string }[],
): Promise<string> {
  const files = buildDocxFiles({ title: novelTitle, author }, chapters);
  return zipToBase64(
    files,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
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

const generators: Record<
  ExportFormat,
  (
    title: string,
    author: string,
    chapters: { title: string; content: string }[],
    novelId: string,
    coverUri?: string,
  ) => string | Promise<string>
> = {
  txt: generateTXT,
  epub: generateEPUB,
  pdf: generatePDF,
  docx: generateDOCX,
  rtf: generateRTF,
};

const extensions: Record<ExportFormat, string> = {
  txt: ".txt",
  epub: ".epub",
  pdf: ".pdf",
  docx: ".docx",
  rtf: ".rtf",
};

const mimeTypes: Record<ExportFormat, string> = {
  txt: "text/plain",
  epub: "application/epub+zip",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
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
    loadChapterContent,
  } = useLibrary();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [longRun, setLongRun] = useState(false);
  const [longEvents, setLongEvents] = useState<TimedEvent[]>([]);
  const [longProgress, setLongProgress] = useState<ExportProgress>({
    phase: "checking",
    chaptersDone: 0,
    chaptersTotal: 0,
  });
  const [longStartedAt, setLongStartedAt] = useState(0);
  const [longNow, setLongNow] = useState(0);
  const [longCancelling, setLongCancelling] = useState(false);
  const [longFormatLabel, setLongFormatLabel] = useState("");
  const [longShowFullLog, setLongShowFullLog] = useState(false);
  const longCancelRef = useRef(false);

  // Keeps the elapsed time moving while a long export runs.
  useEffect(() => {
    if (!longRun) return;
    const timer = setInterval(() => setLongNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [longRun]);
  const [chapterSelectionMode, setChapterSelectionMode] = useState(false);
  const [chapterQuery, setChapterQuery] = useState("");
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
              params: {
                id: novel?.id,
                chapterIndex: originalIndex.toString(),
                from: "novel",
              },
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
  const visibleChapters = filterChaptersByTitle(sortedChapters, chapterQuery);
  const chapterQueryActive = chapterQuery.trim().length > 0;

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
  const handleLongExport = async (format: LongFormat) => {
    const safeTitle = novel.title
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 50);
    const baseDir = `${FileSystem.documentDirectory}exports/${safeTitle}/`;
    const zipPath = `${FileSystem.documentDirectory}exports/${safeTitle}.zip`;
    const chaptersDir = `${FileSystem.documentDirectory}NovelDR/chapters/${novel.id}/`;

    // Sizes drive how chapters are grouped into parts.
    const chapters: { index: number; title: string; bytes: number }[] = [];
    for (let i = 0; i < novel.chapters.length; i++) {
      const info = await FileSystem.getInfoAsync(
        `${chaptersDir}chapter_${i}.json`,
      );
      const bytes = info.exists ? ((info as { size?: number }).size ?? 0) : 0;
      chapters.push({ index: i, title: novel.chapters[i].title, bytes });
    }

    const started = Date.now();
    longCancelRef.current = false;
    setLongCancelling(false);
    setLongShowFullLog(false);
    setLongEvents([]);
    setLongStartedAt(started);
    setLongNow(started);
    setLongProgress({
      phase: "checking",
      chaptersDone: 0,
      chaptersTotal: novel.chapters.length,
    });
    setLongFormatLabel(format.toUpperCase());
    setLongRun(true);
    setExporting(true);

    try {
      const result = await runLongNovelExport(
        {
          novelId: novel.id,
          title: novel.title,
          author: novel.author,
          format,
          chapters,
          baseDir,
          zipPath,
          isCancelled: () => longCancelRef.current,
          onEvent: (e) =>
            setLongEvents((prev) => [...prev, { ...e, at: Date.now() }]),
          onProgress: (p) => setLongProgress(p),
        },
        createDeviceAdapters({
          stagingDir: `${baseDir}staging/`,
          readLibraryChapter: async (index) => {
            const data = await loadChapterContent(novel.id, index);
            if (!data || !data.content) return null;
            return {
              title:
                data.title ||
                novel.chapters[index]?.title ||
                `Chapter ${index + 1}`,
              content: data.content,
            };
          },
        }),
      );

      if (result.zipPath) {
        // Pacing only: lets the Package and Share steps show as complete before the share sheet opens.
        const pause = (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms));
        setLongProgress((p) => ({ ...p, phase: "packaging" }));
        await pause(1500);
        setLongProgress((p) => ({ ...p, phase: "done" }));
        await pause(1500);
        await Sharing.shareAsync(result.zipPath, {
          mimeType: "application/zip",
        });
      } else if (result.phase !== "done") {
        Alert.alert("Export not finished", result.note);
      }
    } catch (error: any) {
      Alert.alert(
        "Export failed",
        error?.message || "The export could not be finished.",
      );
    } finally {
      await FileSystem.deleteAsync(`${baseDir}staging/`, { idempotent: true });
      setLongRun(false);
      setExporting(false);
    }
  };

  const handleLongPdf = async () => {
    const safeTitle = novel.title
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 50);
    const exportDir = `${FileSystem.documentDirectory}exports/`;
    const finalPath = `${exportDir}${safeTitle}.pdf`;

    const started = Date.now();
    longCancelRef.current = false;
    setLongCancelling(false);
    setLongShowFullLog(false);
    setLongEvents([]);
    setLongStartedAt(started);
    setLongNow(started);
    setLongFormatLabel("PDF");
    setLongProgress({
      phase: "reading",
      chaptersDone: 0,
      chaptersTotal: novel.chapters.length,
    });
    setLongRun(true);
    setExporting(true);

    try {
      const dirInfo = await FileSystem.getInfoAsync(exportDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });
      }
      const result = await exportLongPdf(
        {
          title: novel.title,
          author: novel.author,
          chapters: novel.chapters.map((c, i) => ({
            index: i,
            title: c.title,
          })),
          finalPath,
        },
        {
          freeBytes: () => FileSystem.getFreeDiskStorageAsync(),
          readChapter: async (index) => {
            const data = await loadChapterContent(novel.id, index);
            if (!data || !data.content) return null;
            return {
              title:
                data.title ||
                novel.chapters[index]?.title ||
                `Chapter ${index + 1}`,
              content: data.content,
            };
          },
          // Gives the UI a turn between chapters, so the progress card keeps moving.
          yieldToUi: () =>
            new Promise<void>((resolve) => setTimeout(resolve, 0)),
          isCancelled: () => longCancelRef.current,
          onChapter: (done, total) =>
            setLongProgress({
              phase: "reading",
              chaptersDone: done,
              chaptersTotal: total,
            }),
          printToFile: async (html) => {
            const printed = await Print.printToFileAsync({ html });
            return printed.uri;
          },
          moveFile: async (from, to) => {
            await FileSystem.moveAsync({ from, to });
          },
          onEvent: (level, text) =>
            setLongEvents((prev) => [...prev, { level, text, at: Date.now() }]),
        },
      );

      if (result.pdfPath) {
        await Sharing.shareAsync(result.pdfPath, {
          mimeType: "application/pdf",
        });
      } else if (result.phase !== "done") {
        Alert.alert("PDF not created", result.note);
      }
    } catch (error: any) {
      Alert.alert(
        "PDF export failed",
        error?.message || "The PDF could not be created.",
      );
    } finally {
      setLongRun(false);
      setExporting(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (format === "pdf" && novel.chapters.length >= LONG_NOVEL_CHAPTERS) {
      setShowExportModal(false);
      setShowMenu(false);
      await handleLongPdf();
      return;
    }
    if (novel.chapters.length >= LONG_NOVEL_CHAPTERS) {
      setShowExportModal(false);
      setShowMenu(false);
      await handleLongExport(format as LongFormat);
      return;
    }

    setShowExportModal(false);
    setShowMenu(false);
    setExporting(true);
    setExportProgress("Loading chapters...");

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const chapters = await loadFullNovelContent(novel.id, novel.chapters);

      setExportProgress("Generating file...");

      const generator = generators[format];
      const content = await generator(
        novel.title,
        novel.author,
        chapters,
        novel.id,
        novel.coverUrl,
      );

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
      } else if (BINARY_FORMATS.includes(format)) {
        await FileSystem.writeAsStringAsync(filePath, content as string, {
          encoding: FileSystem.EncodingType.Base64,
        });
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
    } catch (error) {
      // Keep the selection so the user can retry the same chapters
      console.error("[Novel] Chapter delete failed:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Chapters not deleted",
        "Something went wrong while deleting these chapters. Please try again.",
      );
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
                      from: "novel",
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

          {novel.chapters.length > 0 && (
            <View style={styles.chapterSearchBlock}>
              <View
                style={[
                  styles.chapterSearchContainer,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="search"
                  size={18}
                  color={colors.textSecondary}
                />
                <TextInput
                  style={[styles.chapterSearchInput, { color: colors.text }]}
                  placeholder="Search chapter titles..."
                  placeholderTextColor={colors.textMuted}
                  value={chapterQuery}
                  onChangeText={setChapterQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  accessibilityLabel="Search chapter titles"
                />
                {chapterQueryActive && (
                  <Pressable
                    onPress={() => setChapterQuery("")}
                    accessibilityLabel="Clear chapter search"
                    hitSlop={8}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                )}
              </View>
              {chapterQueryActive && (
                <Text
                  style={[
                    styles.chapterSearchMeta,
                    { color: colors.textSecondary },
                  ]}
                >
                  Showing {visibleChapters.length} of {novel.chapters.length}
                </Text>
              )}
            </View>
          )}

          <View style={styles.chapterListContainer}>
            <FlatList
              key={chapterListRefreshKey}
              data={visibleChapters}
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
                chapterQueryActive ? (
                  <View style={styles.emptyChapters}>
                    <Text style={[styles.emptyText, { color: colors.text }]}>
                      No chapters match &quot;{chapterQuery.trim()}&quot;
                    </Text>
                    <Text
                      style={[
                        styles.emptyTextSub,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Try a shorter word, or check the chapter number.
                    </Text>
                  </View>
                ) : (
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
                )
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
            {longRun ? (
              <ExportProgressCard
                novelTitle={novel.title}
                formatLabel={longFormatLabel}
                longMode
                progress={longProgress}
                events={longEvents}
                startedAt={longStartedAt}
                now={longNow}
                cancelVisible={longEvents.some(
                  (e) => e.level === "warn" || e.level === "error",
                )}
                cancelling={longCancelling}
                onCancel={() => {
                  longCancelRef.current = true;
                  setLongCancelling(true);
                }}
                showFullLog={longShowFullLog}
                onToggleFullLog={() => setLongShowFullLog((v) => !v)}
              />
            ) : (
              <>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={[styles.progressText, { color: colors.text }]}>
                  {exportProgress}
                </Text>
                <Text
                  style={[
                    styles.progressSubText,
                    { color: colors.textSecondary },
                  ]}
                >
                  This may take a moment for large novels...
                </Text>
              </>
            )}
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
  chapterSearchBlock: { marginBottom: 12, gap: 6 },
  chapterSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  chapterSearchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    paddingVertical: 4,
  },
  chapterSearchMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    paddingLeft: 4,
  },
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
