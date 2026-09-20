import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
  Image,
  AppState,
  AppStateStatus,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

// ─── REFACTORED: All hooks now imported from barrel export ───────────────
import {
  useReaderSettings,
  useCustomFonts,
  useBackgroundSettings,
  useAutoScroll,
  useReaderUI,
  useRapidTapSafety,
  useReadingProgressPersistence,
  useChapterPersistence,
  useScrollTracking,
  useTTS,
  useReaderNavigation,
  useFullscreenMode,
  useDictionary,
  useGlossary,
} from "@/hooks/reader";

import ContentWrapper from "@/components/reader/ContentWrapper";
import ReaderSettingsPanel from "@/components/reader/ReaderSettingsPanel";
import { DefinitionModal } from "@/components/reader/DefinitionModal";
import { GlossaryListModal } from "@/components/reader/GlossaryListModal";

import {
  AUTO_SCROLL_SPEEDS,
  FONT_PRESETS,
  MARGIN_PRESETS,
} from "@/constants/readerSettings";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── Memoized Paragraph Block ─────────────────────────────────────────────
type ParagraphBlockProps = {
  sentences: string[];
  paraIdx: number;
  highlightedSentIdx: number;
  isLastParagraph: boolean;
  fontSize: number;
  lineSpacing: number;
  accentColor: string;
  textColor: string;
  regularFamily: string;
  boldFamily: string;
  highlightedWord: string | null;
  onWordDoubleTap: (word: string) => void;
};

const lastWordTapRef = { word: "", time: 0 };

const ParagraphBlock = React.memo(
  function ParagraphBlock({
    sentences,
    paraIdx,
    highlightedSentIdx,
    isLastParagraph,
    fontSize,
    lineSpacing,
    accentColor,
    textColor,
    regularFamily,
    boldFamily,
    highlightedWord,
    onWordDoubleTap,
  }: ParagraphBlockProps) {
    return (
      <View>
        {sentences.map((sent, sentIdx) => {
          const isHighlighted = sentIdx === highlightedSentIdx;

          return (
            <Text
              key={sentIdx}
              style={[
                {
                  color: textColor,
                  fontSize,
                  lineHeight: fontSize * lineSpacing,
                  fontFamily: regularFamily,
                  marginBottom: fontSize * 0.6,
                  backgroundColor: isHighlighted
                    ? `${accentColor}20`
                    : "transparent",
                  paddingHorizontal: isHighlighted ? 4 : 0,
                  paddingVertical: isHighlighted ? 2 : 0,
                },
              ]}
            >
              {sent.split(/(\s+)/).map((segment, idx) => {
                const isWordHighlighted =
                  highlightedWord &&
                  segment.toLowerCase() === highlightedWord.toLowerCase();

                return (
                  <Text
                    key={idx}
                    onPress={() => {
                      if (segment.trim()) {
                        const now = Date.now();
                        if (
                          lastWordTapRef.word === segment &&
                          now - lastWordTapRef.time < 280
                        ) {
                          onWordDoubleTap(segment);
                          lastWordTapRef.word = "";
                          lastWordTapRef.time = 0;
                        } else {
                          lastWordTapRef.word = segment;
                          lastWordTapRef.time = now;
                        }
                      }
                    }}
                    style={
                      isWordHighlighted
                        ? {
                            backgroundColor: `${accentColor}40`,
                            borderRadius: 4,
                            paddingHorizontal: 3,
                          }
                        : {}
                    }
                  >
                    {segment}
                  </Text>
                );
              })}
            </Text>
          );
        })}
      </View>
    );
  },
  (prev, next) =>
    prev.sentences === next.sentences &&
    prev.highlightedSentIdx === next.highlightedSentIdx &&
    prev.isLastParagraph === next.isLastParagraph &&
    prev.fontSize === next.fontSize &&
    prev.lineSpacing === next.lineSpacing &&
    prev.accentColor === next.accentColor &&
    prev.textColor === next.textColor &&
    prev.regularFamily === next.regularFamily &&
    prev.boldFamily === next.boldFamily &&
    prev.highlightedWord === next.highlightedWord,
);

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────
export default function ReaderScreen() {
  // ─── Routing & Context ────────────────────────────────────────────────
  const { id, chapterIndex: indexParam } = useLocalSearchParams<{
    id: string;
    chapterIndex: string;
  }>();
  const {
    getNovel,
    saveReadingProgress,
    loadChapterContent,
    saveChapterContent,
  } = useLibrary();
  const { colors: themeColors } = useTheme();
  const insets = useSafeAreaInsets();

  // ─── REFACTORED: Reader Settings (NEW extracted hook) ──────────────────
  const {
    fontSizeIdx,
    setFontSizeIdx,
    lineSpacingIdx,
    setLineSpacingIdx,
    marginPresetIdx,
    setMarginPresetIdx,
    autoScrollSpeedIdx,
    setAutoScrollSpeedIdx,
    fontPresetId,
    setFontPresetId,
    activeFontFilename,
    setActiveFontFilename,
    settingsLoaded,
    fontSize,
    lineSpacing,
    marginPreset,
    saveSettings: saveReaderSettings,
  } = useReaderSettings();

  // ─── REFACTORED: Custom Fonts (NEW extracted hook) ──────────────────────
  const {
    customFonts,
    importingFont,
    activeCustomFont,
    activeFontPreset,
    scanCustomFonts,
    importFont,
    deleteFont,
  } = useCustomFonts(activeFontFilename, setActiveFontFilename);

  // ─── REFACTORED: Background Settings (NEW extracted hook) ──────────────
  const {
    bgPresetId,
    bgCustomUri,
    adaptiveColors,
    activePreset,
    bgImageUri,
    bgSolidColor,
    isNoneBackground,
    effectiveBgColor,
    pickCustomImage,
    selectPreset,
    saveBgSettings,
  } = useBackgroundSettings(themeColors);

  // ─── REFACTORED: UI State (NEW extracted hook) ────────────────────────
  const {
    showSettingsSheet,
    setShowSettingsSheet,
    showBgModal,
    setShowBgModal,
    showFontModal,
    setShowFontModal,
    showTTSSettings,
    setShowTTSSettings,
    showTTSHelp,
    setShowTTSHelp,
    showGlossaryListModal,
    setShowGlossaryListModal,
    showTOC,
    setShowTOC,
    showSearch,
    setShowSearch,
    showRapidTapWarning,
    setShowRapidTapWarning,
    quickActionsExpanded,
    setQuickActionsExpanded,
    closeAllPanels,
  } = useReaderUI();

  // ─── Core Content & Scrolling ─────────────────────────────────────────
  const novel = getNovel(id);
  const [chapterIndex, setChapterIndex] = useState(parseInt(indexParam) || 0);
  const chapter = novel?.chapters[chapterIndex];

  const { chapterContent, processedParagraphs, ttsSentences, contentLoading } =
    useChapterPersistence({
      novel,
      chapterIndex,
      loadChapterContent,
      saveChapterContent,
    });

  const {
    scrollRef,
    scrollY,
    readingProgress,
    contentHeight,
    scrollViewHeight,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleScrollViewLayout,
    handleContentSizeChange,
  } = useScrollTracking({ novel, chapterIndex });

  // ─── REFACTORED: Auto-Scroll (NEW extracted hook) ──────────────────────
  const { autoScrollActive, startAutoScroll, stopAutoScroll } = useAutoScroll(
    scrollRef,
    scrollY,
    contentHeight,
    scrollViewHeight,
    autoScrollSpeedIdx,
  );

  // ─── TTS (Text-to-Speech) ─────────────────────────────────────────────
  const goToNextChapter = useCallback(() => {
    if (novel && chapterIndex < novel.chapters.length - 1) {
      setChapterIndex(chapterIndex + 1);
    }
  }, [novel, chapterIndex]);

  const getStartIndexRef = useRef<() => number>(() => 0);

  const {
    ttsActive,
    ttsStalled,
    autoNextCountdownActive,
    ttsIndex,
    toggleTTS,
    stopTTS,
    previewTts,
    ttsAutoNext,
    toggleTtsAutoNext,
    ttsRate,
    setTtsRate,
    ttsVoiceId,
    setTtsVoiceId,
    ttsVoices,
    reloadVoices,
    cancelAutoNext,
  } = useTTS({
    ttsSentences,
    novel,
    chapterIndex,
    goToNextChapter,
    getStartIndex: () => getStartIndexRef.current(),
  });

  // ─── Navigation (TOC, Search) ─────────────────────────────────────────
  const {
    goChapter,
    handleChapterSelect,
    continueReading,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchChapters,
    jumpToSearchResult,
  } = useReaderNavigation({
    novel,
    chapterIndex,
    setChapterIndex,
    saveReadingProgress,
    stopAutoScroll,
    stopTTS,
    cancelAutoNext,
    scrollY,
  });

  // ─── Fullscreen Mode ──────────────────────────────────────────────────
  const { fullscreenMode, barsMounted, toggleFullscreen, uiAnimatedStyle } =
    useFullscreenMode();

  // ─── Dictionary & Glossary ────────────────────────────────────────────
  const glossary = useGlossary();

  useEffect(() => {
    glossary.loadGlossary();
  }, []);

  useEffect(() => {
    if (showGlossaryListModal) {
      glossary.loadGlossary();
    }
  }, [showGlossaryListModal, glossary]);

  const {
    word: dictWord,
    entries: dictEntries,
    notFound: dictNotFound,
    isOpen: showDictModal,
    onlineEntry: dictOnlineEntry,
    fetching: dictFetching,
    isConnected: dictIsConnected,
    lookup: handleWordDoubleTap,
    fetchOnline: handleFetchOnline,
    clear: dismissDictModal,
  } = useDictionary(glossary);

  const handleSaveOfflineEntryToGlossary = useCallback(
    async (word: string, entry: any) => {
      await glossary.addEntry({
        word,
        meaning: entry.meaning,
        pos: entry.pos || "unknown",
        source: "user_added",
        added_at: Date.now(),
        tags: [],
      });
    },
    [glossary],
  );

  // ─── REFACTORED: Rapid Tap Safety (NEW extracted hook) ──────────────────
  const handleRapidTapTripped = useCallback(() => {
    stopTTS();
    stopAutoScroll();
    setShowRapidTapWarning(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    );
  }, [stopTTS, stopAutoScroll]);

  const { registerTap: registerRapidTap, reset: resetRapidTapGuard } =
    useRapidTapSafety(handleRapidTapTripped);

  // ─── REFACTORED: Reading Progress Persistence (NEW extracted hook) ──────
  useReadingProgressPersistence(
    novel,
    chapter,
    chapterIndex,
    scrollY,
    saveReadingProgress,
  );

  // ─── Computed Values ──────────────────────────────────────────────────
  const margins = useMemo(
    () => ({
      horizontal: marginPreset.horizontal,
      vertical: marginPreset.vertical,
    }),
    [marginPreset],
  );

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const activeFontPresetValue = activeCustomFont
    ? {
        id: `custom:${activeCustomFont.filename}`,
        label: activeCustomFont.label,
        regularFamily: activeCustomFont.familyName,
        boldFamily: activeCustomFont.familyName,
      }
    : FONT_PRESETS.find((p) => p.id === fontPresetId) || FONT_PRESETS[0];

  // ─── ReaderSettingsPanel glue ────────────────────────────────────────
  // Selecting a built-in preset must also clear any active custom font,
  // per the ownership note on ReaderSettingsPanelProps.
  const selectBuiltinFontPreset = useCallback(
    (id: string) => {
      setFontPresetId(id);
      setActiveFontFilename(null);
    },
    [setFontPresetId, setActiveFontFilename],
  );

  const onSelectCustomFont = useCallback(
    (font: { filename: string }) => {
      setActiveFontFilename(font.filename);
    },
    [setActiveFontFilename],
  );

  const onDeleteCustomFont = useCallback(
    (font: { filename: string }) => {
      deleteFont(font.filename);
    },
    [deleteFont],
  );

  const currentSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];

  // saveReaderSettings reads current idx/ref state internally rather than
  // taking args, so the panel's (fontSize, lineSpacing, margin, scroll)
  // signature is accepted but unused here.
  const saveAllSettings = useCallback(async () => {
    await saveReaderSettings();
  }, [saveReaderSettings]);

  const paragraphSentences = useMemo(() => {
    return (processedParagraphs || []).map((p: any) => p.sentences || []);
  }, [processedParagraphs]);

  const jumpToPercentage = useCallback(
    (percentage: number) => {
      if (!scrollRef.current) return;
      const targetY = (percentage / 100) * (contentHeight - scrollViewHeight);
      scrollRef.current.scrollTo({ y: targetY, animated: true });
    },
    [contentHeight, scrollViewHeight],
  );

  // ─── RENDER ───────────────────────────────────────────────────────────
  if (!novel || !chapter || !settingsLoaded) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={themeColors.accent} />
      </View>
    );
  }

  return (
    <ContentWrapper
      bgImageUri={bgImageUri}
      bgSolidColor={bgSolidColor}
      defaultBgColor={themeColors.background}
    >
      <View style={[styles.container, { backgroundColor: effectiveBgColor }]}>
        {/* ─── FULLSCREEN MINIMAL TOP BAR ─── */}
        {fullscreenMode && !barsMounted && (
          <View
            style={[
              styles.minimalistTopBar,
              {
                backgroundColor: adaptiveColors.surface,
                borderBottomColor: adaptiveColors.border,
              },
            ]}
          >
            <View style={{ height: topPad }} />
            <View style={styles.minimalistTopBarRow}>
              <Pressable
                onPress={() =>
                  router.replace({
                    pathname: "/novel/[id]",
                    params: { id },
                  })
                }
              >
                <Ionicons name="close" size={18} color={adaptiveColors.text} />
              </Pressable>
              <Text
                style={{
                  color: adaptiveColors.text,
                  fontSize: 12,
                  fontWeight: "600",
                  flex: 1,
                  textAlign: "center",
                  marginHorizontal: 8,
                }}
                numberOfLines={1}
              >
                {chapter.title}
              </Text>
              <Pressable onPress={() => setShowSettingsSheet(true)}>
                <Ionicons
                  name="settings-outline"
                  size={16}
                  color={adaptiveColors.text}
                />
              </Pressable>
            </View>
          </View>
        )}

        {/* ─── TOP BAR (fades out in fullscreen) ─── */}
        {barsMounted && (
          <Animated.View
            pointerEvents={fullscreenMode ? "none" : "auto"}
            style={[
              styles.topBar,
              {
                backgroundColor: adaptiveColors.surface,
                borderBottomColor: adaptiveColors.border,
              },
              uiAnimatedStyle,
            ]}
          >
            <View style={{ height: topPad }} />
            <View style={styles.topBarRow}>
              <Pressable
                style={styles.navBtn}
                onPress={() =>
                  router.replace({
                    pathname: "/novel/[id]",
                    params: { id },
                  })
                }
              >
                <Ionicons name="close" size={22} color={adaptiveColors.text} />
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => toggleFullscreen()}>
                <Text
                  style={[styles.chapterTitle, { color: adaptiveColors.text }]}
                  numberOfLines={1}
                >
                  {chapter.title}
                </Text>
              </Pressable>
              <Pressable
                style={styles.navBtn}
                onPress={() => setShowSettingsSheet(true)}
              >
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={adaptiveColors.text}
                />
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* ─── PROGRESS BAR ─── */}
        <Pressable
          style={[
            styles.progressBarContainer,
            { backgroundColor: adaptiveColors.border },
          ]}
          onPress={(e) => {
            registerRapidTap();
            const { locationX } = e.nativeEvent;
            const percentage = (locationX / SCREEN_W) * 100;
            jumpToPercentage(percentage);
          }}
        >
          <View
            style={[
              styles.progressBar,
              {
                backgroundColor: adaptiveColors.accent,
                width: `${readingProgress}%`,
              },
            ]}
          />
        </Pressable>

        {/* ─── CONTENT AREA ─── */}
        <View style={{ flex: 1, position: "relative" }}>
          <ScrollView
            ref={scrollRef}
            style={styles.scrollArea}
            contentContainerStyle={[
              styles.textContainer,
              {
                paddingHorizontal: margins.horizontal,
                paddingTop: margins.vertical,
                paddingBottom: bottomPad + 120,
              },
            ]}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            onMomentumScrollEnd={handleScrollEndDrag}
            onContentSizeChange={handleContentSizeChange}
            onLayout={handleScrollViewLayout}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={[
                styles.chapterHeader,
                {
                  color: adaptiveColors.accent,
                  marginBottom: fontSize * 1.5,
                  fontSize: fontSize + 4,
                  fontWeight: "bold",
                },
              ]}
            >
              {chapter.title}
            </Text>
            {contentLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={adaptiveColors.accent} />
              </View>
            ) : (
              <View>
                {paragraphSentences.map(
                  (sentences: string[], paraIdx: number) => {
                    const isLastParagraph =
                      paraIdx === paragraphSentences.length - 1;

                    return (
                      <ParagraphBlock
                        key={paraIdx}
                        sentences={sentences}
                        paraIdx={paraIdx}
                        highlightedSentIdx={-1}
                        isLastParagraph={isLastParagraph}
                        fontSize={fontSize}
                        lineSpacing={lineSpacing}
                        accentColor={adaptiveColors.accent}
                        textColor={adaptiveColors.text}
                        regularFamily={activeFontPresetValue.regularFamily}
                        boldFamily={activeFontPresetValue.boldFamily}
                        highlightedWord={null}
                        onWordDoubleTap={handleWordDoubleTap}
                      />
                    );
                  },
                )}
              </View>
            )}
          </ScrollView>
        </View>

        {/* ─── READER SETTINGS PANEL ───────────────────────────────────────
            ReaderSettingsPanel owns its own <Modal visible={showSettingsSheet}>
            internally — do not wrap it in another Modal here, that produced
            a nested-Modal with an undefined `visible` on the inner one. */}
        <ReaderSettingsPanel
          adaptiveColors={adaptiveColors}
          bottomPad={bottomPad}
          showSettingsSheet={showSettingsSheet}
          setShowSettingsSheet={setShowSettingsSheet}
          activeFontPreset={activeFontPresetValue}
          fontPresetId={fontPresetId}
          selectBuiltinFontPreset={selectBuiltinFontPreset}
          showFontModal={showFontModal}
          setShowFontModal={setShowFontModal}
          customFonts={customFonts}
          activeFontFilename={activeFontFilename}
          onSelectCustomFont={onSelectCustomFont}
          onDeleteCustomFont={onDeleteCustomFont}
          onImportFont={importFont}
          importingFont={importingFont}
          fontSize={fontSize}
          fontSizeIdx={fontSizeIdx}
          setFontSizeIdx={setFontSizeIdx}
          lineSpacing={lineSpacing}
          lineSpacingIdx={lineSpacingIdx}
          setLineSpacingIdx={setLineSpacingIdx}
          autoScrollActive={autoScrollActive}
          startAutoScroll={startAutoScroll}
          stopAutoScroll={stopAutoScroll}
          currentSpeed={currentSpeed}
          autoScrollSpeedIdx={autoScrollSpeedIdx}
          setAutoScrollSpeedIdx={setAutoScrollSpeedIdx}
          ttsActive={ttsActive}
          ttsAutoNext={ttsAutoNext}
          toggleTtsAutoNext={toggleTtsAutoNext}
          marginPresetIdx={marginPresetIdx}
          setMarginPresetIdx={setMarginPresetIdx}
          bgPresetId={bgPresetId}
          bgCustomUri={bgCustomUri}
          bgSolidColor={bgSolidColor}
          pickCustomImage={pickCustomImage}
          selectPreset={selectPreset}
          showBgModal={showBgModal}
          setShowBgModal={setShowBgModal}
          saveAllSettings={saveAllSettings}
        />

        {/* ─── DICTIONARY MODAL ─── */}
        {showDictModal && (
          <DefinitionModal
            word={dictWord}
            entries={dictEntries}
            notFound={dictNotFound}
            isOnline={!dictNotFound && dictFetching}
            onlineEntry={dictOnlineEntry}
            isConnected={dictIsConnected}
            fetching={dictFetching}
            onSave={(entry) =>
              handleSaveOfflineEntryToGlossary(dictWord, entry)
            }
            onFetchOnline={handleFetchOnline}
            onClose={dismissDictModal}
          />
        )}

        {/* ─── GLOSSARY LIST MODAL ─── */}
        {showGlossaryListModal && (
          <GlossaryListModal
            entries={glossary.entries}
            onClose={() => setShowGlossaryListModal(false)}
          />
        )}

        {/* ─── RAPID TAP WARNING MODAL ─── */}
        <Modal
          visible={showRapidTapWarning}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowRapidTapWarning(false);
            resetRapidTapGuard();
          }}
        >
          <View style={styles.alertOverlay}>
            <View
              style={[
                styles.alertBox,
                { backgroundColor: adaptiveColors.surface },
              ]}
            >
              <Text style={[styles.alertTitle, { color: adaptiveColors.text }]}>
                Too Many Taps
              </Text>
              <Text
                style={[
                  styles.alertMessage,
                  { color: adaptiveColors.textSecondary },
                ]}
              >
                Your taps are being registered too quickly. Please slow down.
              </Text>
              <Pressable
                style={[
                  styles.alertBtn,
                  { backgroundColor: adaptiveColors.accent },
                ]}
                onPress={() => {
                  setShowRapidTapWarning(false);
                  resetRapidTapGuard();
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>OK</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </ContentWrapper>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    borderBottomWidth: 1,
  },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  navBtn: {
    padding: 8,
    borderRadius: 8,
  },
  chapterTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  minimalistTopBar: {
    borderBottomWidth: 1,
  },
  minimalistTopBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  progressBarContainer: {
    height: 3,
    width: "100%",
  },
  progressBar: {
    height: "100%",
  },
  scrollArea: {
    flex: 1,
  },
  textContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  chapterHeader: {
    marginBottom: 16,
    fontWeight: "bold",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  alertBox: {
    borderRadius: 12,
    padding: 20,
    width: "80%",
    maxWidth: 300,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  alertMessage: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  alertBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
});
