import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from 'expo-print';
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

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

// Export format types
type ExportFormat = "txt" | "epub" | "docx" | "rtf" | "mobi" | "pdf";

// Export options configuration
const EXPORT_OPTIONS: { format: ExportFormat; label: string; icon: string; color: string }[] = [
  { format: "txt", label: "Plain Text (.txt)", icon: "document-text-outline", color: "#4A90E2" },
  { format: "epub", label: "EPUB (.epub)", icon: "book-outline", color: "#27AE60" },
  { format: "pdf", label: "PDF Letter (.pdf)", icon: "document-outline", color: "#FF4444" },
  { format: "docx", label: "Word Document (.docx)", icon: "document-outline", color: "#2B579A" },
  { format: "rtf", label: "Rich Text (.rtf)", icon: "text-outline", color: "#E67E22" },
  { format: "mobi", label: "Kindle (.mobi)", icon: "tablet-portrait-outline", color: "#8E44AD" },
];

// ── Export Functions ────────────────────────────────────────────────────────

async function loadFullNovelContent(
  novelId: string,
  chapters: { title: string; url: string; content?: string }[]
): Promise<{ title: string; content: string }[]> {
  const chaptersDir = `${FileSystem.documentDirectory}NovelDR/chapters/${novelId}/`;
  
  // ── Helper: Check if content has enough words to be real ─────────
  const hasRealContent = (text: string | null | undefined): boolean => {
    if (!text || !text.trim()) return false;
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount >= 100; // At least 100 words to be considered real content
  };
  
  // ── DEDUPLICATE: Keep only one entry per chapter number, prefer ones with real content ─
  const seenNumbers = new Map<number, { title: string; url: string; content?: string }>();
  
  for (const ch of chapters) {
    const num = extractChapterNumber(ch.title, ch.url);
    const existing = seenNumbers.get(num);
    
    if (!existing || (hasRealContent(ch.content) && !hasRealContent(existing.content))) {
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
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const libraryData = await AsyncStorage.getItem('novel_library_v1');
    if (libraryData) {
      const novels = JSON.parse(libraryData);
      legacyNovel = novels.find((n: any) => n.id === novelId);
    }
  } catch (e) {}

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
    } catch (e) {}

    // Fallback to AsyncStorage (only if real content exists)
    if (!content && legacyNovel?.chapters) {
      const urlMatch = legacyNovel.chapters.find(
        (lc: any) => lc.url === ch.url && hasRealContent(lc.content)
      );
      if (urlMatch) {
        content = urlMatch.content;
        if (urlMatch.title) title = urlMatch.title;
      }
    }

    // Fallback to in-memory
    if (!content && hasRealContent(ch.content)) {
      content = ch.content;
    }

    result.push({
      title,
      content: content || `[Content not available for this chapter. Open it in the reader first to migrate the data.]`,
    });
  }

  return result;
}

// Helper to extract chapter number
function extractChapterNumber(title: string, url: string): number {
  const titleMatch = (title || '').match(/chapter\s*(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1]);
  const urlMatch = (url || '').match(/chapter[-/](\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1]);
  return 9999;
}


function generateTXT(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
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

function generateEPUB(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
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
    const paragraphs = ch.content.split('\n\n').filter(p => p.trim());
    for (const p of paragraphs) {
      epub += `<p>${escapeXML(p.trim())}</p>\n`;
    }
    epub += `<hr/>\n`;
  }

  epub += `</body>\n</html>`;
  return epub;
}

function generatePDF(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
  let html = `<html><head><title>${escapeHTML(novelTitle)}</title></head><body style="font-family: serif; line-height: 1.6;">`;
  html += `<h1>${escapeHTML(novelTitle)}</h1>`;
  html += `<p><em>by ${escapeHTML(author)}</em></p>`;
  html += `<hr/>`;

  for (const ch of chapters) {
    html += `<h2>${escapeHTML(ch.title)}</h2>`;
    const paragraphs = ch.content.split('\n\n').filter(p => p.trim());
    for (const p of paragraphs) {
      html += `<p>${escapeHTML(p.trim())}</p>`;
    }
    html += `<hr/>`;
  }

  html += `</body></html>`;
  return html;
}

function generateDOCX(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
  let docx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  docx += `<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n`;
  docx += `<body>\n`;
  docx += `<p><r><rPr><b/><sz val="48"/></rPr><t>${escapeXML(novelTitle)}</t></r></p>\n`;
  docx += `<p><r><t>by ${escapeXML(author)}</t></r></p>\n`;

  for (const ch of chapters) {
    docx += `<p><r><rPr><b/><sz val="32"/></rPr><t>${escapeXML(ch.title)}</t></r></p>\n`;
    const paragraphs = ch.content.split('\n\n').filter(p => p.trim());
    for (const p of paragraphs) {
      docx += `<p><r><t>${escapeXML(p.trim())}</t></r></p>\n`;
    }
  }

  docx += `</body>\n</document>`;
  return docx;
}

function generateRTF(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
  let rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0 {\\fonttbl {\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24\n`;
  rtf += `\\b ${escapeRTF(novelTitle)}\\b0\\par\n`;
  rtf += `by ${escapeRTF(author)}\\par\\par\n`;

  for (const ch of chapters) {
    rtf += `\\b ${escapeRTF(ch.title)}\\b0\\par\n`;
    const paragraphs = ch.content.split('\n\n').filter(p => p.trim());
    for (const p of paragraphs) {
      rtf += `${escapeRTF(p.trim())}\\par\n`;
    }
    rtf += `\\par\n`;
  }

  rtf += `}`;
  return rtf;
}

function generateMOBI(novelTitle: string, author: string, chapters: { title: string; content: string }[]): string {
  // MOBI is complex; for simplicity, we'll generate an HTML-like format
  let mobi = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  mobi += `<html>\n<head><title>${escapeXML(novelTitle)}</title></head>\n`;
  mobi += `<body>\n`;
  mobi += `<h1>${escapeXML(novelTitle)}</h1>\n`;
  mobi += `<p>by ${escapeXML(author)}</p>\n`;

  for (const ch of chapters) {
    mobi += `<h2>${escapeXML(ch.title)}</h2>\n`;
    const paragraphs = ch.content.split('\n\n').filter(p => p.trim());
    for (const p of paragraphs) {
      mobi += `<p>${escapeXML(p.trim())}</p>\n`;
    }
  }

  mobi += `</body>\n</html>`;
  return mobi;
}

function escapeXML(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRTF(str: string): string {
  return str.replace(/[\\{}]/g, (c) => '\\' + c).replace(/[\n]/g, '\\par\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NovelScreen() {
  const { id: novelId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { library, deleteChapters } = useLibrary();

  // ── Find novel ──────────────────────────────────────────────────────────────
  const novel = library.find((n) => n.id === novelId);

  // ── State ───────────────────────────────────────────────────────────────────
  const [sortOrder, setSortOrder] = useState<"ascending" | "descending">("ascending");
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("Preparing...");

  // ── Batch Delete State ──────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);

  if (!novel) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Novel not found</Text>
      </View>
    );
  }

  // ── Sort chapters ───────────────────────────────────────────────────────────
  const sortedChapters = [...novel.chapters].sort((a, b) => {
    const numA = extractChapterNumber(a.title, a.url);
    const numB = extractChapterNumber(b.title, b.url);
    return sortOrder === "ascending" ? numA - numB : numB - numA;
  });

  // ── Toggle sort ─────────────────────────────────────────────────────────────
  const toggleSortOrder = () => {
    setSortOrder(sortOrder === "ascending" ? "descending" : "ascending");
  };

  // ── Chapter selection handlers ──────────────────────────────────────────────
  const handleChapterLongPress = (chapterUrl: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    toggleChapterSelection(chapterUrl);
  };

  const toggleChapterSelection = (chapterUrl: string) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterUrl)) {
        next.delete(chapterUrl);
      } else {
        next.add(chapterUrl);
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedChapters(new Set());
  };

  const performBatchDelete = async () => {
    try {
      const chaptersToDelete = Array.from(selectedChapters);
      await deleteChapters(novel.id, chaptersToDelete);
      setConfirmDeleteVisible(false);
      exitSelectionMode();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("Batch delete failed:", error);
      Alert.alert("Error", "Failed to delete chapters");
    }
  };

  // ── Export handler ──────────────────────────────────────────────────────────
  const handleExport = async (format: ExportFormat) => {
    try {
      setShowExportModal(false);
      setExporting(true);
      setExportProgress("Loading chapters...");

      const fullContent = await loadFullNovelContent(novel.id, novel.chapters);

      setExportProgress(`Generating ${format.toUpperCase()}...`);

      let fileContent: string;
      let fileName: string;

      switch (format) {
        case "txt":
          fileContent = generateTXT(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.txt`;
          break;
        case "epub":
          fileContent = generateEPUB(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.epub`;
          break;
        case "pdf":
          fileContent = generatePDF(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.pdf`;
          break;
        case "docx":
          fileContent = generateDOCX(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.docx`;
          break;
        case "rtf":
          fileContent = generateRTF(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.rtf`;
          break;
        case "mobi":
          fileContent = generateMOBI(novel.title, novel.author, fullContent);
          fileName = `${novel.title}.mobi`;
          break;
        default:
          throw new Error("Unsupported format");
      }

      setExportProgress("Saving file...");

      // Save to temporary directory and share
      const tempPath = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(tempPath, fileContent);

      await Sharing.shareAsync(tempPath, {
        mimeType: format === "pdf" ? "application/pdf" : "application/octet-stream",
        dialogTitle: `Export ${novel.title}`,
      });

      setExporting(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("Export failed:", error);
      setExporting(false);
      Alert.alert("Export Failed", "Could not export the novel. Please try again.");
    }
  };

  // ── Render chapter item ─────────────────────────────────────────────────────
  const renderChapterItem = ({ item: chapter }: any) => {
    const isSelected = selectedChapters.has(chapter.url);
    return (
      <Pressable
        onPress={() => {
          if (selectionMode) {
            toggleChapterSelection(chapter.url);
          } else {
            router.push({
              pathname: "/reader/[id]",
              params: { id: novel.id, chapterUrl: chapter.url },
            });
          }
        }}
        onLongPress={() => handleChapterLongPress(chapter.url)}
        delayLongPress={300}
      >
        <View style={[styles.chapterRow, { backgroundColor: isSelected ? colors.accent + "20" : colors.card, borderColor: isSelected ? colors.accent : colors.border }]}>
          {selectionMode && (
            <View style={styles.chapterCheckbox}>
              <Ionicons
                name={isSelected ? "checkbox" : "square-outline"}
                size={20}
                color={isSelected ? colors.accent : colors.textSecondary}
              />
            </View>
          )}
          <Text style={[styles.chapterTitle, { color: colors.text }]} numberOfLines={2}>
            {chapter.title}
          </Text>
          {!selectionMode && (
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          )}
        </View>
      </Pressable>
    );
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const keyExtractor = (item: any, index: number) => `${item.url}-${index}`;
  const getItemLayout = (data: any, index: number) => ({
    length: 60,
    offset: 60 * index,
    index,
  });

  const firstParagraph = novel.synopsis.split("\n\n")[0] || "";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Selection Header (shown when in selection mode) */}
      {selectionMode && (
        <View style={[styles.selectionHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={[styles.selectionTitle, { color: colors.text }]}>
            {selectedChapters.size} selected
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              onPress={() => setConfirmDeleteVisible(true)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
              })}
            >
              <Ionicons name="trash-outline" size={20} color="#FF4444" />
            </Pressable>
            <Pressable
              onPress={exitSelectionMode}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
              })}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Normal Header */}
      {!selectionMode && (
        <View style={[styles.navBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={colors.accent} />
            <Text style={[styles.backLabel, { color: colors.accent }]}>Back</Text>
          </Pressable>
          <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
            {novel.title}
          </Text>
          <Pressable style={styles.menuBtn} onPress={() => setShowMenu(true)}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.accent} />
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.coverWrap, { shadowColor: colors.shadow }]}>
            {novel.coverUrl ? (
              <Image source={{ uri: novel.coverUrl }} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.coverPlaceholder, { backgroundColor: colors.surface }]}>
                <Ionicons name="book" size={40} color={colors.accent} />
              </View>
            )}
          </View>

          <View style={styles.heroInfo}>
            <Text style={[styles.heroTitle, { color: colors.text }]} numberOfLines={2}>
              {novel.title}
            </Text>
            <Text style={[styles.heroAuthor, { color: colors.textSecondary }]}>{novel.author}</Text>

            {novel.lastRead && (
              <View style={styles.progressCard}>
                <View style={styles.progressTop}>
                  <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>Progress</Text>
                  <Text style={[styles.progressCount, { color: colors.accent }]}>
                    {novel.lastRead.chapterIndex + 1} / {novel.chapters.length}
                  </Text>
                </View>
                <View style={[styles.progressBar, { backgroundColor: colors.surface }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${((novel.lastRead.chapterIndex + 1) / novel.chapters.length) * 100}%`,
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                </View>
                {novel.lastRead.scrollProgress && (
                  <Text style={[styles.lastReadLabel, { color: colors.textSecondary }]}>
                    Last read: Chapter {novel.lastRead.chapterIndex + 1}
                  </Text>
                )}
              </View>
            )}

            <Pressable
              onPress={() => {
                if (novel.chapters.length > 0) {
                  const startIdx = novel.lastRead?.chapterIndex || 0;
                  router.push({
                    pathname: "/reader/[id]",
                    params: {
                      id: novel.id,
                      chapterUrl: novel.chapters[startIdx].url,
                    },
                  });
                }
              }}
              style={({ pressed }) => [
                styles.readBtn,
                { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="book" size={16} color="#fff" />
              <Text style={styles.readBtnText}>
                {novel.lastRead ? "Continue" : "Start Reading"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.content}>
          <Pressable
            style={[styles.synopsisCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setSynopsisExpanded((e) => !e)}
          >
            <Text style={[styles.synopsisText, { color: colors.textSecondary }]}>
              {synopsisExpanded ? novel.synopsis : firstParagraph}
              {!synopsisExpanded && novel.synopsis.length > firstParagraph.length ? "..." : ""}
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
          </View>

          <View style={styles.chapterListContainer}>
            <FlatList
              data={sortedChapters}
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
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    No chapters available yet.
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </ScrollView>

      {/* Batch Delete Confirmation Modal */}
      <Modal
        visible={confirmDeleteVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setConfirmDeleteVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Ionicons name="alert-circle" size={48} color={colors.text} style={styles.modalIcon} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Confirm Deletion</Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              This will permanently delete {selectedChapters.size} chapter(s).{"\n\n"}
              Are you sure about this? {"\n\n"}
              If YES, click the 'DELETE' button.
            </Text>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton, { borderColor: colors.border }]}
                onPress={() => setConfirmDeleteVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalDeleteButton, { backgroundColor: "#FF4444" }]}
                onPress={performBatchDelete}
              >
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>DELETE</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.menuTitle, { color: colors.text }]} numberOfLines={1}>{novel.title}</Text>
            <Pressable style={[styles.menuItem, { borderColor: colors.border }]} onPress={() => { setShowMenu(false); setShowExportModal(true); }}>
              <Ionicons name="download-outline" size={20} color={colors.accent} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Export Novel</Text>
            </Pressable>
            <Pressable style={[styles.menuItem, { borderColor: colors.border }]} onPress={() => setShowMenu(false)}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Novel Info</Text>
            </Pressable>
            <Pressable style={[styles.menuCancelBtn, { borderColor: colors.border }]} onPress={() => setShowMenu(false)}>
              <Text style={[styles.menuCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showExportModal} transparent animationType="slide" onRequestClose={() => setShowExportModal(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setShowExportModal(false)}>
          <View style={[styles.exportContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Export as...</Text>
            {EXPORT_OPTIONS.map((option) => (
              <Pressable key={option.format} style={[styles.exportItem, { borderColor: colors.border }]} onPress={() => handleExport(option.format)}>
                <Ionicons name={option.icon as any} size={20} color={option.color} />
                <Text style={[styles.menuItemText, { color: colors.text }]}>{option.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.menuCancelBtn, { borderColor: colors.border }]} onPress={() => setShowExportModal(false)}>
              <Text style={[styles.menuCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={exporting} transparent animationType="fade">
        <View style={styles.menuOverlay}>
          <View style={[styles.progressModal, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.progressText, { color: colors.text }]}>{exportProgress}</Text>
            <Text style={[styles.progressSubText, { color: colors.textSecondary }]}>This may take a moment for large novels...</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8, minWidth: 70 },
  backLabel: { fontFamily: "Inter_500Medium", fontSize: 15 },
  navTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1, textAlign: "center" },
  menuBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  // Selection header
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18 },
  selectionActions: { flexDirection: "row", gap: 4 },

  hero: { flexDirection: "row", padding: 20, gap: 16, alignItems: "flex-start" },
  coverWrap: { width: 100, height: 140, borderRadius: 12, overflow: "hidden", flexShrink: 0, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  heroInfo: { flex: 1, gap: 6 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 17, lineHeight: 24 },
  heroAuthor: { fontFamily: "Inter_400Regular", fontSize: 13 },
  heroButtons: { marginTop: 10 },
  readBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, alignSelf: "flex-start" },
  readBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  content: { paddingHorizontal: 16, gap: 12 },
  progressCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  progressTop: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontFamily: "Inter_500Medium", fontSize: 13 },
  progressCount: { fontFamily: "Inter_700Bold", fontSize: 13 },
  progressBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  lastReadLabel: { fontFamily: "Inter_400Regular", fontSize: 12 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  synopsisCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  synopsisText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  seeMoreRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeMore: { fontFamily: "Inter_500Medium", fontSize: 13 },
  chapterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  sortBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  chapterListContainer: { minHeight: 200 },
  chapterRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 6 },
  chapterCheckbox: { marginRight: 10 },
  chapterTitle: { fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 },
  emptyChapters: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: 'center' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  menuContainer: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 4 },
  menuTitle: { fontFamily: "Inter_700Bold", fontSize: 17, marginBottom: 12, textAlign: 'center' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuItemText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  menuCancelBtn: { marginTop: 12, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  menuCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  exportContainer: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 4, maxHeight: '70%' },
  exportItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  progressModal: { marginHorizontal: 40, borderRadius: 16, padding: 30, alignItems: 'center', gap: 12, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  progressText: { fontFamily: "Inter_600SemiBold", fontSize: 16, textAlign: 'center' },
  progressSubText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: 'center' },

  // Batch delete modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "80%", borderRadius: 16, padding: 20, alignItems: "center", gap: 12 },
  modalIcon: { marginBottom: 8 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  modalMessage: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 16, width: "100%" },
  modalButton: { flex: 1, height: 44, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  modalCancelButton: { borderWidth: 1 },
  modalDeleteButton: { backgroundColor: "#ff4444" },
  modalButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
