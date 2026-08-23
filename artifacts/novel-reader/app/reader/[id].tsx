import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Font from "expo-font";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import notifee, { AuthorizationStatus } from "@notifee/react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

// --- Extracted modules ---
import ContentWrapper from "@/components/reader/ContentWrapper";
import ReaderSettingsPanel from "@/components/reader/ReaderSettingsPanel";
import {
  FONT_SIZES,
  LINE_SPACINGS,
  AUTO_SCROLL_SPEEDS,
  MARGIN_PRESETS,
  TTS_MIN_CHARS,
  RAPID_TAP_THRESHOLD,
  RAPID_TAP_WINDOW_MS,
  READER_SETTINGS_FILE,
  TTS_SETTINGS_FILE,
  BG_SETTINGS_FILE,
  BG_PRESETS,
  FONT_PRESETS,
  isLightColor,
} from "@/constants/readerSettings";
import { useChapterPersistence } from "@/hooks/reader/useChapterPersistence";
import { useScrollTracking } from "@/hooks/reader/useScrollTracking";
import { useTTS } from "@/hooks/reader/useTTS";
import { useReaderNavigation } from "@/hooks/reader/useReaderNavigation";
import { useFullscreenMode } from "@/hooks/reader/useFullscreenMode";
import { useDictionary } from "@/hooks/reader/useDictionary";
import { useGlossary } from "@/hooks/reader/useGlossary";
import { DefinitionModal } from "@/components/reader/DefinitionModal";
import { GlossaryListModal } from "@/components/reader/GlossaryListModal";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── ParagraphBlock (memoized) ───────────────────────────────────────────
type ParagraphBlockProps = {
  sentences: string[];
  paraIdx: number;
  highlightedSentIdx: number;
  isLastParagraph: boolean;
  fontSize: number;
  lineSpacing: number;
  accentColor: string;
  textColor: string;
  contentStyle: any;
  regularFamily: string;
  boldFamily: string;
  highlightedWord: string | null;
  onParaLayout: (paraIdx: number, y: number, height: number) => void;
  onHighlightedSentenceLayout: (relY: number) => void;
  onWordDoubleTap: (word: string) => void;
};

// 280ms window to distinguish a double-tap from two separate single taps.
// Tracked per-render via a module-level ref map keyed by paraIdx-sentIdx-word
// would be overkill; a single mutable ref shared across all words in the
// reader is enough since only one word can be "the last tapped word" at a time.
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
    contentStyle,
    regularFamily,
    boldFamily,
    highlightedWord,
    onParaLayout,
    onHighlightedSentenceLayout,
    onWordDoubleTap,
  }: ParagraphBlockProps) {
    return (
      <View
        style={{ marginBottom: isLastParagraph ? 0 : fontSize * 1.5 }}
        onLayout={(e) =>
          onParaLayout(
            paraIdx,
            e.nativeEvent.layout.y,
            e.nativeEvent.layout.height,
          )
        }
      >
        {sentences.map((sentence, sentIdx) => {
          const trimmed = sentence.trim();
          const endsWithPeriod = /[.!?]$/.test(trimmed);
          const isExclamation = /[!?]$/.test(trimmed);
          const isQuestion = /\?$/.test(trimmed);
          let marginBottom = fontSize * 0.3;
          if (isQuestion) marginBottom = fontSize * 0.7;
          else if (isExclamation) marginBottom = fontSize * 0.8;
          else if (endsWithPeriod) marginBottom = fontSize * 0.5;
          const hasDialogue = /^["'""'']/.test(trimmed);
          if (hasDialogue && sentIdx > 0) marginBottom += fontSize * 0.2;

          const isHighlighted = sentIdx === highlightedSentIdx;
          // Bold weight for dialogue (and for the TTS-highlighted sentence,
          // same as before). Custom/bundled fonts generally don't support
          // fontWeight synthesis reliably in React Native, so bold has to
          // be a genuinely separate font family rather than a style flag.
          const useBold = isHighlighted || hasDialogue;

          return (
            <Text
              key={sentIdx}
              onLayout={
                isHighlighted
                  ? (e) => onHighlightedSentenceLayout(e.nativeEvent.layout.y)
                  : undefined
              }
              style={[
                contentStyle,
                {
                  color: isHighlighted ? accentColor : textColor,
                  backgroundColor: isHighlighted
                    ? `${accentColor}20`
                    : "transparent",
                  fontFamily: useBold ? boldFamily : regularFamily,
                  fontSize,
                  lineHeight: fontSize * lineSpacing,
                  marginBottom,
                  paddingVertical: 2,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  letterSpacing: 0.2,
                },
              ]}
            >
              {trimmed.split(/(\s+)/).map((segment, wIdx) => {
                if (!segment.trim()) return segment;

                // Check if this word matches the highlighted word
                const cleanSegment = segment
                  .toLowerCase()
                  .replace(/^[^a-z']+|[^a-z']+$/g, "");
                const isWordHighlighted =
                  highlightedWord &&
                  cleanSegment ===
                    highlightedWord
                      .toLowerCase()
                      .replace(/^[^a-z']+|[^a-z']+$/g, "");

                return (
                  <Text
                    key={wIdx}
                    onPress={() => {
                      const now = Date.now();
                      const clean = segment.toLowerCase();
                      if (
                        lastWordTapRef.word === clean &&
                        now - lastWordTapRef.time < 280
                      ) {
                        lastWordTapRef.word = "";
                        onWordDoubleTap(segment);
                      } else {
                        lastWordTapRef.word = clean;
                        lastWordTapRef.time = now;
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

// ─── Rapid‑tap guard ──────────────────────────────────────────────────────
function useRapidTapGuard(onTripped: () => void) {
  const tapTimestampsRef = useRef<number[]>([]);
  const trippedRef = useRef(false);

  const registerTap = useCallback(() => {
    const now = Date.now();
    const recent = tapTimestampsRef.current.filter(
      (t) => now - t < RAPID_TAP_WINDOW_MS,
    );
    recent.push(now);
    tapTimestampsRef.current = recent;

    if (recent.length >= RAPID_TAP_THRESHOLD && !trippedRef.current) {
      trippedRef.current = true;
      onTripped();
    }
  }, [onTripped]);

  const reset = useCallback(() => {
    tapTimestampsRef.current = [];
    trippedRef.current = false;
  }, []);

  return { registerTap, reset };
}

// ─── Custom fonts (user-imported .ttf/.otf) ──────────────────────────────
// Not in constants/readerSettings.ts on purpose - unlike FONT_PRESETS these
// aren't known at build time, they're discovered by scanning disk at
// startup, so there's nothing static to declare there.
type CustomFont = {
  filename: string; // name on disk inside CUSTOM_FONTS_DIR - the persisted identity
  label: string; // display name, derived from filename
  familyName: string; // family name registered with Font.loadAsync, re-derived from filename each scan
};

const CUSTOM_FONTS_DIR = `${FileSystem.documentDirectory}NovelDR/custom_fonts/`;
const FONT_FILE_EXT_RE = /\.(ttf|otf)$/i;

// Small deterministic string hash (not cryptographic - just needs to be
// stable across app restarts and cheap). Folded into the family name so
// two different filenames that sanitize to the same base string (e.g.
// "My-Font.ttf" and "My_Font.ttf") still register as distinct families.
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function familyNameForFilename(filename: string): string {
  const base = filename
    .replace(FONT_FILE_EXT_RE, "")
    .replace(/[^a-zA-Z0-9]/g, "_");
  return `CustomFont_${base}_${hashString(filename)}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────
export default function ReaderScreen() {
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

  // ── Reader settings state ──
  const [fontSizeIdx, setFontSizeIdx] = useState(3);
  const [lineSpacingIdx, setLineSpacingIdx] = useState(2);
  const fontSize = FONT_SIZES[fontSizeIdx];
  const lineSpacing = LINE_SPACINGS[lineSpacingIdx];
  const [marginPresetIdx, setMarginPresetIdx] = useState(1);
  const [autoScrollSpeedIdx, setAutoScrollSpeedIdx] = useState(1);
  const [fontPresetId, setFontPresetId] = useState<string>("default");
  // saveAllSettings reads this ref rather than the fontPresetId state
  // directly, since it can be called synchronously right after
  // setFontPresetId - before the state update has actually committed -
  // the same way the other controls pass their "new" value explicitly
  // instead of trusting stale state.
  const fontPresetIdRef = useRef(fontPresetId);

  // ── Custom (user-imported) fonts ──
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [activeFontFilename, setActiveFontFilename] = useState<string | null>(
    null,
  );
  // Same "read the ref, not the state" reasoning as fontPresetIdRef above -
  // saveAllSettings can run synchronously right after setActiveFontFilename.
  const activeFontFilenameRef = useRef<string | null>(activeFontFilename);
  const [importingFont, setImportingFont] = useState(false);

  const activeCustomFont = activeFontFilename
    ? customFonts.find((f) => f.filename === activeFontFilename)
    : undefined;
  // When a custom font is active it wins over the built-in preset. Custom
  // fonts are a single imported file with no separate bold weight, so bold
  // text falls back to rendering in the same (non-bold) family - graceful
  // rather than crashing or silently reverting to the default font.
  const activeFontPreset = activeCustomFont
    ? {
        id: `custom:${activeCustomFont.filename}`,
        label: activeCustomFont.label,
        regularFamily: activeCustomFont.familyName,
        boldFamily: activeCustomFont.familyName,
      }
    : (FONT_PRESETS.find((p) => p.id === fontPresetId) ?? FONT_PRESETS[0]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showBgModal, setShowBgModal] = useState(false);
  const [showFontModal, setShowFontModal] = useState(false);
  const [showRapidTapWarning, setShowRapidTapWarning] = useState(false);
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(true);

  // ── Glossary list modal (view all saved words) ──
  const [showGlossaryListModal, setShowGlossaryListModal] = useState(false);

  // ── Dictionary lookup (double-tap a word) ──
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
  } = useDictionary();

  // ── Glossary (persistent user dictionary) ──
  const glossary = useGlossary();

  // Load glossary on mount
  useEffect(() => {
    glossary.loadGlossary();
  }, []);

  // ── Fullscreen mode (toggle button + double-tap gesture + fade) ──
  const { fullscreenMode, barsMounted, toggleFullscreen, uiAnimatedStyle } =
    useFullscreenMode();

  // ── Background state ──
  const [bgPresetId, setBgPresetId] = useState<string>("none");
  const [bgCustomUri, setBgCustomUri] = useState<string | null>(null);
  const [adaptiveColors, setAdaptiveColors] = useState({
    text: themeColors.text,
    textSecondary: themeColors.textSecondary,
    accent: themeColors.accent,
    surface: themeColors.surface,
    card: themeColors.card,
    border: themeColors.border,
  });

  // ── Auto‑scroll state ──
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Chapter index ──
  const [chapterIndex, setChapterIndex] = useState(parseInt(indexParam) || 0);

  // ── Novel and chapter ──
  const novel = getNovel(id);
  const chapter = novel?.chapters[chapterIndex];

  // ── Hooks ──
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
    isUserScrollingRef,
  } = useScrollTracking({ novel, chapterIndex });

  // ── Auto‑scroll methods (must be defined before useReaderNavigation) ──
  const stopAutoScroll = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAutoScrollActive(false);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const speed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
    intervalRef.current = setInterval(() => {
      if (!scrollRef.current) return;
      const currentY = scrollY;
      const maxY = Math.max(0, contentHeight - scrollViewHeight);
      if (currentY >= maxY) {
        stopAutoScroll();
        return;
      }
      const newY = Math.min(maxY, currentY + (30 * speed) / 20);
      scrollRef.current.scrollTo({ y: newY, animated: false });
    }, 50);
    setAutoScrollActive(true);
  }, [
    autoScrollSpeedIdx,
    stopAutoScroll,
    scrollY,
    contentHeight,
    scrollViewHeight,
    scrollRef,
  ]);

  // ── TTS ──
  const goToNextChapter = useCallback(() => {
    goChapter(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    showTTSSettings,
    setShowTTSSettings,
    showTTSHelp,
    setShowTTSHelp,
    cancelAutoNext,
  } = useTTS({
    ttsSentences,
    novel,
    chapterIndex,
    goToNextChapter,
  });

  // ── Navigation ──
  const {
    goChapter,
    handleChapterSelect,
    continueReading,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchChapters,
    jumpToSearchResult,
    showTOC,
    setShowTOC,
    showSearch,
    setShowSearch,
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

  // ── Rapid‑tap guard ──
  const handleRapidTapTripped = useCallback(() => {
    stopTTS();
    stopAutoScroll();
    setShowRapidTapWarning(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    );
  }, [stopTTS, stopAutoScroll]);

  const { registerTap: registerRapidTap, reset: resetRapidTapGuard } =
    useRapidTapGuard(handleRapidTapTripped);

  // ── Re‑arm auto‑scroll when speed changes ──
  useEffect(() => {
    if (autoScrollActive) {
      startAutoScroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScrollSpeedIdx]);

  // ── Persist reading progress on background / unmount ──
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        (appStateRef.current === "active" &&
          nextAppState.match(/inactive|background/)) ||
        nextAppState === "background"
      ) {
        if (novel && chapter) {
          saveReadingProgress(novel.id, chapterIndex, chapter.title, scrollY);
        }
      }
      appStateRef.current = nextAppState;
    };
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => {
      subscription.remove();
      if (novel && chapter) {
        saveReadingProgress(novel.id, chapterIndex, chapter.title, scrollY);
      }
    };
  }, [novel, chapter, chapterIndex, scrollY, saveReadingProgress]);

  // ── Scan custom_fonts/ and register each with expo-font ──
  // Runs at mount (below) and again after import/delete so the picker and
  // the actual registered font families never drift out of sync.
  const scanCustomFonts = useCallback(async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(CUSTOM_FONTS_DIR);
      if (!dirInfo.exists) {
        setCustomFonts([]);
        return;
      }
      const filenames = await FileSystem.readDirectoryAsync(CUSTOM_FONTS_DIR);
      const loaded: CustomFont[] = [];
      for (const filename of filenames) {
        if (!FONT_FILE_EXT_RE.test(filename)) continue;
        const familyName = familyNameForFilename(filename);
        try {
          await Font.loadAsync({
            [familyName]: `${CUSTOM_FONTS_DIR}${filename}`,
          });
          loaded.push({
            filename,
            label: filename.replace(FONT_FILE_EXT_RE, ""),
            familyName,
          });
        } catch (err) {
          // Missing/corrupt font file - skip it rather than crashing the
          // reader. It's left on disk; the user can re-import instead.
          console.warn(`Failed to load custom font "${filename}":`, err);
        }
      }
      setCustomFonts(loaded);
      // If the font that was active last session failed to load this time
      // (deleted from disk outside the app, or corrupted), fall back to
      // the default preset instead of rendering with an unregistered family.
      if (
        activeFontFilenameRef.current &&
        !loaded.some((f) => f.filename === activeFontFilenameRef.current)
      ) {
        activeFontFilenameRef.current = null;
        setActiveFontFilename(null);
      }
    } catch (error) {
      console.error("Failed to scan custom fonts:", error);
    }
  }, []);

  // ── Load settings ──
  useEffect(() => {
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(READER_SETTINGS_FILE);
        if (fileInfo.exists) {
          const content =
            await FileSystem.readAsStringAsync(READER_SETTINGS_FILE);
          const settings = JSON.parse(content);
          if (settings.fontSizeIdx !== undefined)
            setFontSizeIdx(settings.fontSizeIdx);
          if (settings.lineSpacingIdx !== undefined)
            setLineSpacingIdx(settings.lineSpacingIdx);
          if (settings.marginPresetIdx !== undefined)
            setMarginPresetIdx(settings.marginPresetIdx);
          if (settings.autoScrollSpeedIdx !== undefined)
            setAutoScrollSpeedIdx(settings.autoScrollSpeedIdx);
          if (settings.fontPresetId !== undefined) {
            setFontPresetId(settings.fontPresetId);
            fontPresetIdRef.current = settings.fontPresetId;
          }
          if (settings.activeFontFilename !== undefined) {
            setActiveFontFilename(settings.activeFontFilename);
            activeFontFilenameRef.current = settings.activeFontFilename;
          }
        }
      } catch (error) {
        console.error("Failed to load reader settings:", error);
      }

      try {
        const bgInfo = await FileSystem.getInfoAsync(BG_SETTINGS_FILE);
        if (bgInfo.exists) {
          const bgContent =
            await FileSystem.readAsStringAsync(BG_SETTINGS_FILE);
          const bgSettings = JSON.parse(bgContent);
          if (bgSettings.presetId) setBgPresetId(bgSettings.presetId);
          if (bgSettings.customUri) setBgCustomUri(bgSettings.customUri);
        }
      } catch (e) {
        console.warn("Failed to load bg settings:", e);
      }

      await scanCustomFonts();

      setSettingsLoaded(true);
    })();
  }, []);

  // ── Background colors ──
  const activePreset = BG_PRESETS.find((p) => p.id === bgPresetId);
  const bgImageUri = bgCustomUri ?? null;
  const bgSolidColor =
    !bgCustomUri && activePreset && activePreset.id !== "none"
      ? activePreset.color
      : null;
  const isNoneBackground = !bgCustomUri && activePreset?.id === "none";
  const effectiveBgColor = isNoneBackground
    ? themeColors.background
    : "transparent";

  const updateAdaptiveColors = useCallback(async () => {
    if (bgCustomUri) {
      setAdaptiveColors({
        text: "#F0F0F0",
        textSecondary: "#B0B0B0",
        accent: "#58A6FF",
        surface: "rgba(30, 30, 40, 0.85)",
        card: "rgba(20, 20, 30, 0.85)",
        border: "rgba(100, 100, 120, 0.5)",
      });
    } else if (activePreset && activePreset.id !== "none") {
      setAdaptiveColors({
        text: activePreset.textColor,
        textSecondary: activePreset.textColorSecondary,
        accent: activePreset.accentColor || themeColors.accent,
        surface: isLightColor(activePreset.color)
          ? "rgba(255, 255, 255, 0.9)"
          : "rgba(0, 0, 0, 0.7)",
        card: isLightColor(activePreset.color)
          ? "rgba(255, 255, 255, 0.85)"
          : "rgba(0, 0, 0, 0.6)",
        border: isLightColor(activePreset.color)
          ? "rgba(0, 0, 0, 0.1)"
          : "rgba(255, 255, 255, 0.1)",
      });
    } else {
      setAdaptiveColors({
        text: themeColors.text,
        textSecondary: themeColors.textSecondary,
        accent: themeColors.accent,
        surface: themeColors.surface,
        card: themeColors.card,
        border: themeColors.border,
      });
    }
  }, [bgCustomUri, activePreset, themeColors]);

  useEffect(() => {
    updateAdaptiveColors();
  }, [bgPresetId, bgCustomUri, updateAdaptiveColors]);

  const saveBgSettings = async (presetId: string, customUri: string | null) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const di = await FileSystem.getInfoAsync(dir);
      if (!di.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        BG_SETTINGS_FILE,
        JSON.stringify({ presetId, customUri }),
      );
    } catch (e) {
      console.warn("Failed to save bg settings:", e);
    }
  };

  const pickCustomImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setBgCustomUri(uri);
      setBgPresetId("none");
      setShowBgModal(false);
      saveBgSettings("none", uri);
      setAdaptiveColors({
        text: "#F0F0F0",
        textSecondary: "#B0B0B0",
        accent: "#58A6FF",
        surface: "rgba(30, 30, 40, 0.85)",
        card: "rgba(20, 20, 30, 0.85)",
        border: "rgba(100, 100, 120, 0.5)",
      });
    }
  };

  const selectPreset = (preset: (typeof BG_PRESETS)[0]) => {
    setBgPresetId(preset.id);
    setBgCustomUri(null);
    setShowBgModal(false);
    saveBgSettings(preset.id, null);
  };

  const saveTtsSettings = async (voiceId: string | undefined, rate: number) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        TTS_SETTINGS_FILE,
        JSON.stringify({ voiceId, rate, autoNext: ttsAutoNext }),
      );
    } catch (e) {
      console.warn("[TTS] Failed to save settings:", e);
    }
  };

  const saveAllSettings = async (
    fontSize: number,
    lineSpacing: number,
    margin: number,
    scroll: number,
  ) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        READER_SETTINGS_FILE,
        JSON.stringify({
          fontSizeIdx: fontSize,
          lineSpacingIdx: lineSpacing,
          marginPresetIdx: margin,
          autoScrollSpeedIdx: scroll,
          fontPresetId: fontPresetIdRef.current,
          activeFontFilename: activeFontFilenameRef.current,
        }),
      );
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  // ── Font selection ──
  const selectBuiltinFontPreset = (id: string) => {
    activeFontFilenameRef.current = null;
    setActiveFontFilename(null);
    fontPresetIdRef.current = id;
    setFontPresetId(id);
    saveAllSettings(
      fontSizeIdx,
      lineSpacingIdx,
      marginPresetIdx,
      autoScrollSpeedIdx,
    );
    setShowFontModal(false);
  };

  const selectCustomFont = (font: CustomFont) => {
    activeFontFilenameRef.current = font.filename;
    setActiveFontFilename(font.filename);
    saveAllSettings(
      fontSizeIdx,
      lineSpacingIdx,
      marginPresetIdx,
      autoScrollSpeedIdx,
    );
    setShowFontModal(false);
  };

  // Type filter is deliberately loose ("*/*" rather than a font MIME type):
  // Android's SAF picker is inconsistent about reporting font MIME types
  // (often just "application/octet-stream"), so the extension check below
  // is the reliable gate, same reasoning as the .txt check in Settings.
  const handleImportFont = async () => {
    if (importingFont) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const file = result.assets[0];
      const ext = file.name.match(FONT_FILE_EXT_RE)?.[0]?.toLowerCase();
      if (!ext) {
        Alert.alert(
          "Unsupported File",
          "Please choose a .ttf or .otf font file.",
        );
        return;
      }

      setImportingFont(true);

      const dirInfo = await FileSystem.getInfoAsync(CUSTOM_FONTS_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CUSTOM_FONTS_DIR, {
          intermediates: true,
        });
      }

      // Avoid clobbering an existing font that shares the same filename by
      // suffixing until a free name is found.
      const baseName = file.name
        .replace(FONT_FILE_EXT_RE, "")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim();
      const safeBase = baseName || "Custom_Font";
      let targetName = `${safeBase}${ext}`;
      let counter = 2;
      while (
        (await FileSystem.getInfoAsync(`${CUSTOM_FONTS_DIR}${targetName}`))
          .exists
      ) {
        targetName = `${safeBase}_${counter}${ext}`;
        counter++;
      }

      const destUri = `${CUSTOM_FONTS_DIR}${targetName}`;
      await FileSystem.copyAsync({ from: file.uri, to: destUri });

      // Validate it actually registers as a font before keeping it - if
      // this throws, the file is not a valid/readable font.
      const familyName = familyNameForFilename(targetName);
      try {
        await Font.loadAsync({ [familyName]: destUri });
      } catch (err) {
        await FileSystem.deleteAsync(destUri, { idempotent: true });
        Alert.alert(
          "Import Failed",
          "That file doesn't look like a valid font.",
        );
        return;
      }

      setCustomFonts((prev) => [
        ...prev,
        { filename: targetName, label: safeBase, familyName },
      ]);
    } catch (error) {
      console.error("Failed to import custom font:", error);
      Alert.alert("Import Failed", "Something went wrong importing that font.");
    } finally {
      setImportingFont(false);
    }
  };

  const handleDeleteCustomFont = (font: CustomFont) => {
    Alert.alert(
      "Delete Font",
      `Remove "${font.label}" from your fonts? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await FileSystem.deleteAsync(
                `${CUSTOM_FONTS_DIR}${font.filename}`,
                { idempotent: true },
              );
            } catch (error) {
              console.error("Failed to delete custom font file:", error);
            }
            setCustomFonts((prev) =>
              prev.filter((f) => f.filename !== font.filename),
            );
            if (activeFontFilenameRef.current === font.filename) {
              activeFontFilenameRef.current = null;
              setActiveFontFilename(null);
              fontPresetIdRef.current = "default";
              setFontPresetId("default");
              saveAllSettings(
                fontSizeIdx,
                lineSpacingIdx,
                marginPresetIdx,
                autoScrollSpeedIdx,
              );
            }
          },
        },
      ],
    );
  };

  const getMargins = () => {
    switch (marginPresetIdx) {
      case 0:
        return { horizontal: 12, vertical: 16 };
      case 1:
        return { horizontal: 22, vertical: 20 };
      case 2:
        return { horizontal: 32, vertical: 28 };
      default:
        return { horizontal: 22, vertical: 20 };
    }
  };
  const margins = getMargins();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const currentSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];

  // ── Paragraph layout tracking ──
  const paraYPositionsRef = useRef<Map<number, number>>(new Map());
  const paraHeightsRef = useRef<Map<number, number>>(new Map());
  const highlightedSentenceRelYRef = useRef<number | null>(null);
  const [highlightLayoutVersion, setHighlightLayoutVersion] = useState(0);

  const handleParaLayout = useCallback(
    (idx: number, y: number, height: number) => {
      paraYPositionsRef.current.set(idx, y);
      paraHeightsRef.current.set(idx, height);
    },
    [],
  );

  const handleHighlightedSentenceLayout = useCallback((relY: number) => {
    highlightedSentenceRelYRef.current = relY;
    setHighlightLayoutVersion((v) => v + 1);
  }, []);

  const paragraphSentences = useMemo(
    () =>
      processedParagraphs.map((p) =>
        p.split(/(?<=[.!?])\s+(?=[A-Z0-9""'‘({[<])/),
      ),
    [processedParagraphs],
  );

  const ttsToRenderKeyMap = useMemo(() => {
    const map = new Map<number, string>();
    let i = 0;
    for (let paraIdx = 0; paraIdx < paragraphSentences.length; paraIdx++) {
      const sentences = paragraphSentences[paraIdx];
      for (let sentIdx = 0; sentIdx < sentences.length; sentIdx++) {
        map.set(i, `${paraIdx}-${sentIdx}`);
        i++;
      }
    }
    return map;
  }, [paragraphSentences]);

  const currentHighlightKey =
    ttsIndex >= 0 ? ttsToRenderKeyMap.get(ttsIndex) : undefined;
  const currentParaIdx = currentHighlightKey
    ? parseInt(currentHighlightKey.split("-")[0], 10)
    : -1;

  // TTS follow‑scroll effect
  useEffect(() => {
    if (!ttsActive || currentParaIdx < 0 || !currentHighlightKey) return;
    if (isUserScrollingRef.current) return;
    const paraY = paraYPositionsRef.current.get(currentParaIdx);
    if (paraY === undefined) return;
    const sentenceRelY = highlightedSentenceRelYRef.current;
    const targetCenter = paraY + (sentenceRelY ?? 0);
    const blockHeightEstimate = fontSize * lineSpacing * 1.8;
    const centerOffset = blockHeightEstimate * 2;
    const targetY = Math.max(
      0,
      targetCenter - scrollViewHeight / 2 + centerOffset,
    );
    scrollRef.current?.scrollTo({ y: targetY, animated: true });
  }, [
    currentHighlightKey,
    currentParaIdx,
    ttsIndex,
    ttsSentences,
    ttsActive,
    fontSize,
    lineSpacing,
    highlightLayoutVersion,
    scrollViewHeight,
    isUserScrollingRef,
    scrollRef,
  ]);

  const jumpToPercentage = (percentage: number) => {
    if (contentHeight > scrollViewHeight) {
      const maxScroll = contentHeight - scrollViewHeight;
      const targetY = (percentage / 100) * maxScroll;
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    }
  };

  // ── Background setup modal state ──
  const [showBackgroundSetup, setShowBackgroundSetup] = useState(false);
  const [notifPermGranted, setNotifPermGranted] = useState<boolean | null>(
    null,
  );
  const [batteryOptExempt, setBatteryOptExempt] = useState<boolean | null>(
    null,
  );
  const [powerManagerAvailable, setPowerManagerAvailable] = useState(false);

  const refreshBackgroundSetupStatus = useCallback(async () => {
    if (Platform.OS !== "android") return;
    try {
      const settings = await notifee.getNotificationSettings();
      setNotifPermGranted(
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED,
      );
    } catch {
      setNotifPermGranted(null);
    }
    try {
      const exempt = await notifee.isBatteryOptimizationEnabled();
      setBatteryOptExempt(!exempt);
    } catch {
      setBatteryOptExempt(null);
    }
    try {
      const info = await notifee.getPowerManagerInfo();
      setPowerManagerAvailable(!!info?.activity);
    } catch {
      setPowerManagerAvailable(false);
    }
  }, []);

  useEffect(() => {
    if (showBackgroundSetup) refreshBackgroundSetupStatus();
  }, [showBackgroundSetup, refreshBackgroundSetupStatus]);

  const handleRequestNotificationPerm = useCallback(async () => {
    try {
      await notifee.requestPermission();
    } catch (e) {
      console.warn(
        "[BackgroundSetup] Notification permission request failed:",
        e,
      );
    }
    await refreshBackgroundSetupStatus();
  }, [refreshBackgroundSetupStatus]);

  const handleOpenBatteryOptimizationSettings = useCallback(async () => {
    try {
      await notifee.openBatteryOptimizationSettings();
    } catch (e) {
      console.warn(
        "[BackgroundSetup] Could not open battery optimization settings:",
        e,
      );
    }
  }, []);

  const handleOpenPowerManagerSettings = useCallback(async () => {
    try {
      await notifee.openPowerManagerSettings();
    } catch (e) {
      console.warn(
        "[BackgroundSetup] Could not open power manager settings:",
        e,
      );
    }
  }, []);

  // ── Loading state ──
  if (!novel || !chapter || !settingsLoaded) {
    return (
      <View
        style={[styles.center, { backgroundColor: themeColors.background }]}
      >
        <ActivityIndicator size="large" color={themeColors.accent} />
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ─── RENDER ──────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <ContentWrapper
      bgImageUri={bgImageUri}
      bgSolidColor={bgSolidColor}
      defaultBgColor={themeColors.background}
    >
      <View style={[styles.container, { backgroundColor: effectiveBgColor }]}>
        {/* ─── FULLSCREEN MINIMAL TOP BAR (shown once normal bars finish fading out) ─── */}
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
                accessibilityLabel="Close reader"
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

              <Pressable
                onPress={() => setShowSettingsSheet(true)}
                accessibilityLabel="Reader settings"
              >
                <Ionicons
                  name="settings-outline"
                  size={16}
                  color={adaptiveColors.text}
                />
              </Pressable>
            </View>
          </View>
        )}

        {/* ─── TOP BAR (fades out, then unmounts to reclaim layout space) ─── */}
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
                accessibilityLabel="Close reader"
              >
                <Ionicons name="close" size={22} color={adaptiveColors.text} />
              </Pressable>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => setShowSettingsSheet(false)}
              >
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
                accessibilityLabel="Reader settings"
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

        {/* ─── PROGRESS BAR (always visible) ─── */}
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
          accessibilityLabel={`Reading progress ${Math.round(readingProgress)} percent`}
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

        {/* Content area */}
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
                {paragraphSentences.map((sentences, paraIdx) => {
                  const isLastParagraph =
                    paraIdx === paragraphSentences.length - 1;

                  let highlightedSentIdx = -1;
                  if (currentHighlightKey) {
                    const [hPara, hSent] = currentHighlightKey.split("-");
                    if (parseInt(hPara, 10) === paraIdx) {
                      highlightedSentIdx = parseInt(hSent, 10);
                    }
                  }

                  return (
                    <ParagraphBlock
                      key={paraIdx}
                      sentences={sentences}
                      paraIdx={paraIdx}
                      highlightedSentIdx={highlightedSentIdx}
                      isLastParagraph={isLastParagraph}
                      fontSize={fontSize}
                      lineSpacing={lineSpacing}
                      accentColor={adaptiveColors.accent}
                      textColor={adaptiveColors.text}
                      contentStyle={styles.content}
                      regularFamily={activeFontPreset.regularFamily}
                      boldFamily={activeFontPreset.boldFamily}
                      highlightedWord={dictWord}
                      onParaLayout={handleParaLayout}
                      onHighlightedSentenceLayout={
                        handleHighlightedSentenceLayout
                      }
                      onWordDoubleTap={handleWordDoubleTap}
                    />
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* TTS status overlay */}
          {ttsActive && ttsIndex >= 0 && ttsIndex < ttsSentences.length && (
            <View
              style={[
                styles.ttsSentenceBox,
                {
                  backgroundColor: adaptiveColors.accent + "12",
                  borderColor: adaptiveColors.accent + "40",
                },
              ]}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={14}
                color={adaptiveColors.accent}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.ttsSentenceLabel,
                    { color: adaptiveColors.accent },
                  ]}
                >
                  Now reading
                </Text>
                <Text
                  style={[
                    styles.ttsSentenceText,
                    { color: adaptiveColors.text },
                  ]}
                  numberOfLines={2}
                >
                  {ttsSentences[ttsIndex].length > 100
                    ? ttsSentences[ttsIndex].substring(0, 100) + "..."
                    : ttsSentences[ttsIndex]}
                </Text>
              </View>
            </View>
          )}

          {/* Auto Next countdown */}
          {autoNextCountdownActive && (
            <Pressable
              onPress={cancelAutoNext}
              style={[
                styles.ttsSentenceBox,
                {
                  backgroundColor: adaptiveColors.accent + "12",
                  borderColor: adaptiveColors.accent + "40",
                },
              ]}
            >
              <Ionicons
                name="play-skip-forward-outline"
                size={14}
                color={adaptiveColors.accent}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.ttsSentenceLabel,
                    { color: adaptiveColors.accent },
                  ]}
                >
                  Chapter finished
                </Text>
                <Text
                  style={[
                    styles.ttsSentenceText,
                    { color: adaptiveColors.text },
                  ]}
                >
                  Moving to next chapter in 3s — tap to cancel
                </Text>
              </View>
            </Pressable>
          )}

          {/* Stall banner */}
          {ttsStalled && (
            <Pressable
              style={[
                styles.ttsStalledBanner,
                {
                  backgroundColor: adaptiveColors.accent + "20",
                  borderColor: adaptiveColors.accent,
                },
              ]}
              onPress={() => {
                if (ttsIndex >= 0 && ttsIndex < ttsSentences.length) {
                  toggleTTS();
                } else {
                  stopTTS();
                }
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color={adaptiveColors.accent}
              />
              <Text
                style={{
                  color: adaptiveColors.text,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                Narration stalled — tap to resume
              </Text>
            </Pressable>
          )}

          {/* ─── RIGHT COLUMN (fullscreen pill + quick actions cluster) ─── */}
          {chapterContent.length >= TTS_MIN_CHARS && (
            <View style={styles.rightColumn}>
              {/* Fullscreen pill - separate button above cluster */}
              <Pressable
                style={[
                  styles.fullscreenPill,
                  {
                    backgroundColor: fullscreenMode
                      ? adaptiveColors.accent
                      : adaptiveColors.card,
                    borderColor: fullscreenMode
                      ? adaptiveColors.accent
                      : adaptiveColors.border,
                  },
                ]}
                onPress={toggleFullscreen}
                accessibilityLabel={
                  fullscreenMode ? "Exit fullscreen" : "Enter fullscreen"
                }
              >
                <Ionicons
                  name={fullscreenMode ? "contract" : "expand"}
                  size={18}
                  color={fullscreenMode ? "#fff" : adaptiveColors.text}
                />
              </Pressable>

              {/* Quick actions cluster - chevron + expandable actions */}
              <View
                style={[
                  styles.quickActionsCluster,
                  {
                    backgroundColor: adaptiveColors.card,
                    borderColor: adaptiveColors.border,
                  },
                ]}
              >
                {/* Chevron toggle */}
                <Pressable
                  style={styles.quickActionsToggle}
                  onPress={() => setQuickActionsExpanded((v) => !v)}
                  accessibilityLabel={
                    quickActionsExpanded
                      ? "Hide quick actions"
                      : "Show quick actions"
                  }
                >
                  <Ionicons
                    name={quickActionsExpanded ? "chevron-down" : "chevron-up"}
                    size={16}
                    color={adaptiveColors.text}
                  />
                </Pressable>

                {/* Expanded actions — chevron alone controls visibility, in both modes */}
                {quickActionsExpanded && (
                  <>
                    <Pressable
                      style={styles.quickActionBtn}
                      onPress={() => setShowBackgroundSetup(true)}
                      accessibilityLabel="Background playback setup"
                    >
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={16}
                        color={adaptiveColors.text}
                      />
                    </Pressable>

                    <Pressable
                      style={styles.quickActionBtn}
                      onPress={() => setShowTTSHelp(true)}
                      accessibilityLabel="TTS guidebook"
                    >
                      <Ionicons
                        name="book-outline"
                        size={16}
                        color={adaptiveColors.text}
                      />
                    </Pressable>

                    <Pressable
                      style={[
                        styles.quickActionBtn,
                        styles.ttsPlayBtnInner,
                        { backgroundColor: adaptiveColors.accent },
                      ]}
                      onPress={() => {
                        registerRapidTap();
                        toggleTTS();
                      }}
                      onLongPress={() => {
                        Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Medium,
                        ).catch(() => {});
                        setShowTTSSettings(true);
                      }}
                      delayLongPress={400}
                      accessibilityLabel={
                        ttsActive ? "Pause narration" : "Start narration"
                      }
                    >
                      <Ionicons
                        name={ttsActive ? "pause" : "volume-high"}
                        size={18}
                        color="#fff"
                      />
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          )}
        </View>

        {/* ─── BOTTOM NAV (fades out, then unmounts to reclaim layout space) ─── */}
        {barsMounted && (
          <Animated.View
            pointerEvents={fullscreenMode ? "none" : "auto"}
            style={[
              styles.bottomNav,
              {
                backgroundColor: adaptiveColors.surface,
                borderTopColor: adaptiveColors.border,
                paddingBottom: bottomPad + 8,
              },
              uiAnimatedStyle,
            ]}
          >
            <Pressable
              style={[
                styles.navChBtn,
                {
                  backgroundColor:
                    chapterIndex === 0
                      ? adaptiveColors.border
                      : adaptiveColors.card,
                  borderColor: adaptiveColors.border,
                },
              ]}
              onPress={() => {
                registerRapidTap();
                goChapter(-1);
              }}
              disabled={chapterIndex === 0}
            >
              <Ionicons
                name="chevron-back"
                size={18}
                color={
                  chapterIndex === 0
                    ? adaptiveColors.textSecondary
                    : adaptiveColors.text
                }
              />
              <Text
                style={[
                  styles.navChText,
                  {
                    color:
                      chapterIndex === 0
                        ? adaptiveColors.textSecondary
                        : adaptiveColors.text,
                  },
                ]}
              >
                Prev
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tocButton, { borderColor: adaptiveColors.border }]}
              onPress={() => setShowTOC(true)}
            >
              <Text
                style={[styles.tocButtonText, { color: adaptiveColors.text }]}
              >
                {chapterIndex + 1} / {novel.chapters.length}
              </Text>
              <Text
                style={[
                  styles.readingPercent,
                  { color: adaptiveColors.textSecondary },
                ]}
              >
                {Math.round(readingProgress)}%
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.navChBtn,
                {
                  backgroundColor:
                    chapterIndex === novel.chapters.length - 1
                      ? adaptiveColors.border
                      : adaptiveColors.accent,
                  borderColor:
                    chapterIndex === novel.chapters.length - 1
                      ? adaptiveColors.border
                      : adaptiveColors.accent,
                },
              ]}
              onPress={() => {
                registerRapidTap();
                goChapter(1);
              }}
              disabled={chapterIndex === novel.chapters.length - 1}
            >
              <Text
                style={[
                  styles.navChText,
                  {
                    color:
                      chapterIndex === novel.chapters.length - 1
                        ? adaptiveColors.textSecondary
                        : "#fff",
                  },
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  chapterIndex === novel.chapters.length - 1
                    ? adaptiveColors.textSecondary
                    : "#fff"
                }
              />
            </Pressable>
          </Animated.View>
        )}

        {/* ─── FULLSCREEN MINIMAL BAR (shown once normal bars finish fading out) ─── */}
        {fullscreenMode && !barsMounted && (
          <View
            style={[
              styles.minimalistBottomBar,
              {
                backgroundColor: adaptiveColors.surface,
                borderTopColor: adaptiveColors.border,
                paddingBottom: bottomPad + 4,
              },
            ]}
          >
            <Pressable
              onPress={() => goChapter(-1)}
              disabled={chapterIndex === 0}
              accessibilityLabel="Previous chapter"
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={
                  chapterIndex === 0
                    ? adaptiveColors.textSecondary
                    : adaptiveColors.text
                }
              />
            </Pressable>

            <Text
              style={{
                color: adaptiveColors.text,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {chapterIndex + 1} / {novel.chapters.length}
            </Text>

            <Pressable
              onPress={() => goChapter(1)}
              disabled={chapterIndex === novel.chapters.length - 1}
              accessibilityLabel="Next chapter"
            >
              <Ionicons
                name="chevron-forward"
                size={20}
                color={
                  chapterIndex === novel.chapters.length - 1
                    ? adaptiveColors.textSecondary
                    : adaptiveColors.accent
                }
              />
            </Pressable>
          </View>
        )}

        {/* ─── READER SETTINGS PANEL (settings sheet, font picker, background presets) ─── */}
        <ReaderSettingsPanel
          adaptiveColors={adaptiveColors}
          bottomPad={bottomPad}
          showSettingsSheet={showSettingsSheet}
          setShowSettingsSheet={setShowSettingsSheet}
          activeFontPreset={activeFontPreset}
          fontPresetId={fontPresetId}
          selectBuiltinFontPreset={selectBuiltinFontPreset}
          showFontModal={showFontModal}
          setShowFontModal={setShowFontModal}
          customFonts={customFonts}
          activeFontFilename={activeFontFilename}
          onSelectCustomFont={selectCustomFont}
          onDeleteCustomFont={handleDeleteCustomFont}
          onImportFont={handleImportFont}
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

        {/* ─── TTS HELP MODAL ─── */}
        <Modal
          visible={showTTSHelp}
          animationType="fade"
          transparent
          onRequestClose={() => setShowTTSHelp(false)}
        >
          <Pressable
            style={styles.ttsModalOverlay}
            onPress={() => setShowTTSHelp(false)}
          >
            <Pressable
              style={[
                styles.ttsHelpModal,
                { backgroundColor: adaptiveColors.surface },
              ]}
              onPress={() => {}}
            >
              <View
                style={[
                  styles.ttsModalHandle,
                  { backgroundColor: adaptiveColors.border },
                ]}
              />
              <Text
                style={[styles.ttsModalTitle, { color: adaptiveColors.text }]}
              >
                How to Use Text-to-Speech
              </Text>
              {[
                {
                  icon: "volume-high",
                  title: "Start / Pause Reading",
                  desc: "Tap the speaker button to start TTS. Tap again to pause.",
                },
                {
                  icon: "settings-outline",
                  title: "Open TTS Settings",
                  desc: "Long-press the speaker button (hold ~0.4s) to open the settings panel.",
                },
                {
                  icon: "refresh",
                  title: "Load More Voices",
                  desc: "Inside settings, if no voices appear, tap Reload Engines to fetch available voices.",
                },
                {
                  icon: "musical-note",
                  title: "Change Voice & Speed",
                  desc: "Select a voice chip and a speed (0.5x–2.5x), then tap Preview Voice to test it.",
                },
                {
                  icon: "close-circle-outline",
                  title: "Close Settings",
                  desc: "Tap Save Values or tap anywhere outside the panel to dismiss settings.",
                },
              ].map(({ icon, title, desc }) => (
                <View key={title} style={styles.ttsHelpItem}>
                  <View
                    style={[
                      styles.ttsHelpIconWrap,
                      { backgroundColor: adaptiveColors.accent + "20" },
                    ]}
                  >
                    <Ionicons
                      name={icon as any}
                      size={18}
                      color={adaptiveColors.accent}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.ttsHelpTitle,
                        { color: adaptiveColors.text },
                      ]}
                    >
                      {title}
                    </Text>
                    <Text
                      style={[
                        styles.ttsHelpDesc,
                        { color: adaptiveColors.textSecondary },
                      ]}
                    >
                      {desc}
                    </Text>
                  </View>
                </View>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ─── BACKGROUND PLAYBACK SETUP MODAL ─── */}
        <Modal
          visible={showBackgroundSetup}
          animationType="fade"
          transparent
          onRequestClose={() => setShowBackgroundSetup(false)}
        >
          <Pressable
            style={styles.ttsModalOverlay}
            onPress={() => setShowBackgroundSetup(false)}
          >
            <Pressable
              style={[
                styles.ttsHelpModal,
                { backgroundColor: adaptiveColors.surface },
              ]}
              onPress={() => {}}
            >
              <View
                style={[
                  styles.ttsModalHandle,
                  { backgroundColor: adaptiveColors.border },
                ]}
              />
              <Text
                style={[styles.ttsModalTitle, { color: adaptiveColors.text }]}
              >
                Background Playback Setup
              </Text>
              <Text
                style={[
                  styles.ttsHelpDesc,
                  { color: adaptiveColors.textSecondary, marginBottom: 12 },
                ]}
              >
                Optional. Some phones stop narration when you lock the screen.
                These settings fix that.
              </Text>
              <View style={styles.ttsHelpItem}>
                <View
                  style={[
                    styles.ttsHelpIconWrap,
                    {
                      backgroundColor:
                        notifPermGranted === true
                          ? "#22C55E20"
                          : adaptiveColors.accent + "20",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      notifPermGranted === true
                        ? "checkmark-circle"
                        : "notifications-outline"
                    }
                    size={18}
                    color={
                      notifPermGranted === true
                        ? "#22C55E"
                        : adaptiveColors.accent
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.ttsHelpTitle,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    Allow Notifications
                  </Text>
                  <Text
                    style={[
                      styles.ttsHelpDesc,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    Required so Android knows narration is active.
                  </Text>
                  <Pressable
                    style={[
                      styles.ttsBackgroundSetupBtn,
                      { borderColor: adaptiveColors.border },
                    ]}
                    onPress={
                      notifPermGranted === false
                        ? () => Linking.openSettings()
                        : handleRequestNotificationPerm
                    }
                  >
                    <Text
                      style={[
                        styles.ttsBackgroundSetupBtnText,
                        { color: adaptiveColors.accent },
                      ]}
                    >
                      {notifPermGranted === true
                        ? "Granted"
                        : notifPermGranted === false
                          ? "Open App Settings"
                          : "Allow Notifications"}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.ttsHelpItem}>
                <View
                  style={[
                    styles.ttsHelpIconWrap,
                    {
                      backgroundColor:
                        batteryOptExempt === true
                          ? "#22C55E20"
                          : adaptiveColors.accent + "20",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      batteryOptExempt === true
                        ? "checkmark-circle"
                        : "battery-charging-outline"
                    }
                    size={18}
                    color={
                      batteryOptExempt === true
                        ? "#22C55E"
                        : adaptiveColors.accent
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.ttsHelpTitle,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    Disable Battery Optimization
                  </Text>
                  <Text
                    style={[
                      styles.ttsHelpDesc,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    Prevents Android from restricting background activity.
                  </Text>
                  <Pressable
                    style={[
                      styles.ttsBackgroundSetupBtn,
                      { borderColor: adaptiveColors.border },
                    ]}
                    onPress={handleOpenBatteryOptimizationSettings}
                  >
                    <Text
                      style={[
                        styles.ttsBackgroundSetupBtnText,
                        { color: adaptiveColors.accent },
                      ]}
                    >
                      {batteryOptExempt === true
                        ? "Exempt — Open Anyway"
                        : "Open Battery Settings"}
                    </Text>
                  </Pressable>
                </View>
              </View>
              {powerManagerAvailable && (
                <View style={styles.ttsHelpItem}>
                  <View
                    style={[
                      styles.ttsHelpIconWrap,
                      { backgroundColor: adaptiveColors.accent + "20" },
                    ]}
                  >
                    <Ionicons
                      name="phone-portrait-outline"
                      size={18}
                      color={adaptiveColors.accent}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.ttsHelpTitle,
                        { color: adaptiveColors.text },
                      ]}
                    >
                      Enable Autostart
                    </Text>
                    <Text
                      style={[
                        styles.ttsHelpDesc,
                        { color: adaptiveColors.textSecondary },
                      ]}
                    >
                      Manufacturer-specific restriction on some devices.
                    </Text>
                    <Pressable
                      style={[
                        styles.ttsBackgroundSetupBtn,
                        { borderColor: adaptiveColors.border },
                      ]}
                      onPress={handleOpenPowerManagerSettings}
                    >
                      <Text
                        style={[
                          styles.ttsBackgroundSetupBtnText,
                          { color: adaptiveColors.accent },
                        ]}
                      >
                        Open Autostart Settings
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ─── TTS SETTINGS MODAL ─── */}
        <Modal
          visible={showTTSSettings}
          animationType="slide"
          transparent
          statusBarTranslucent
          onRequestClose={() => setShowTTSSettings(false)}
        >
          <View style={styles.ttsModalOverlay}>
            <Pressable
              style={styles.ttsModalDismiss}
              onPress={() => setShowTTSSettings(false)}
            />
            <View
              style={[
                styles.ttsModalSheet,
                { backgroundColor: adaptiveColors.surface },
              ]}
            >
              <View
                style={[
                  styles.ttsModalHandle,
                  { backgroundColor: adaptiveColors.border },
                ]}
              />
              {ttsVoices.length === 0 ? (
                <>
                  <Text
                    style={[
                      styles.ttsModalTitle,
                      { color: adaptiveColors.text, textAlign: "center" },
                    ]}
                  >
                    No Engines Found
                  </Text>
                  <Pressable
                    style={[
                      styles.ttsReloadBtn,
                      { backgroundColor: adaptiveColors.accent },
                    ]}
                    onPress={reloadVoices}
                  >
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text
                      style={{
                        color: "#fff",
                        fontWeight: "600",
                        marginLeft: 8,
                      }}
                    >
                      Reload Engines
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text
                    style={[
                      styles.ttsModalSubtitle,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    Voice Speed
                  </Text>
                  <View style={styles.speedButtonsRow}>
                    {[1.0, 1.3, 1.5, 2.0, 2.5].map((rate) => (
                      <Pressable
                        key={rate}
                        style={[
                          styles.speedButton,
                          {
                            backgroundColor:
                              Math.abs(ttsRate - rate) < 0.01
                                ? adaptiveColors.accent
                                : adaptiveColors.card,
                            borderColor: adaptiveColors.border,
                          },
                        ]}
                        onPress={() => {
                          setTtsRate(rate);
                          saveTtsSettings(ttsVoiceId, rate);
                        }}
                      >
                        <Text
                          style={[
                            styles.speedButtonText,
                            {
                              color:
                                Math.abs(ttsRate - rate) < 0.01
                                  ? "#fff"
                                  : adaptiveColors.text,
                            },
                          ]}
                        >
                          {rate}x
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.ttsModalSubtitle,
                      { color: adaptiveColors.text, marginTop: 16 },
                    ]}
                  >
                    Voices
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
                  >
                    {ttsVoices.map((voice) => {
                      const isSelected = ttsVoiceId === voice.identifier;
                      return (
                        <Pressable
                          key={voice.identifier}
                          style={[
                            styles.ttsVoiceChip,
                            {
                              backgroundColor: isSelected
                                ? adaptiveColors.accent
                                : adaptiveColors.card,
                              borderColor: isSelected
                                ? adaptiveColors.accent
                                : adaptiveColors.border,
                            },
                          ]}
                          onPress={() => {
                            setTtsVoiceId(voice.identifier);
                            saveTtsSettings(voice.identifier, ttsRate);
                          }}
                        >
                          <Text
                            style={[
                              styles.ttsVoiceChipText,
                              {
                                color: isSelected
                                  ? "#fff"
                                  : adaptiveColors.text,
                              },
                            ]}
                          >
                            {voice.name ?? voice.identifier}
                          </Text>
                          <Text
                            style={[
                              styles.ttsVoiceChipLang,
                              {
                                color: isSelected
                                  ? "rgba(255,255,255,0.7)"
                                  : adaptiveColors.textSecondary,
                              },
                            ]}
                          >
                            {voice.language}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.ttsButtonsRow}>
                    <Pressable
                      style={[
                        styles.ttsPreviewBtn,
                        { borderColor: adaptiveColors.accent },
                      ]}
                      onPress={previewTts}
                    >
                      <Ionicons
                        name="play-circle-outline"
                        size={20}
                        color={adaptiveColors.accent}
                      />
                      <Text
                        style={{ color: adaptiveColors.accent, marginLeft: 6 }}
                      >
                        Preview Voice
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.ttsSaveBtn,
                        { backgroundColor: adaptiveColors.accent },
                      ]}
                      onPress={() => setShowTTSSettings(false)}
                    >
                      <Text style={{ color: "#fff", fontWeight: "600" }}>
                        Save Values
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ─── TABLE OF CONTENTS MODAL ─── */}
        <Modal
          visible={showTOC}
          animationType="slide"
          transparent
          onRequestClose={() => setShowTOC(false)}
        >
          <View
            style={[
              styles.modalOverlay,
              { backgroundColor: "rgba(0,0,0,0.5)" },
            ]}
          >
            <View
              style={[
                styles.modalContent,
                { backgroundColor: adaptiveColors.surface },
              ]}
            >
              <View style={styles.modalHeader}>
                <Text
                  style={[styles.modalTitle, { color: adaptiveColors.text }]}
                >
                  Table of Contents
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => setShowSearch(true)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons
                      name="search"
                      size={24}
                      color={adaptiveColors.text}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => setShowTOC(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={adaptiveColors.text}
                    />
                  </Pressable>
                </View>
              </View>
              {novel.lastRead && novel.lastRead.chapterIndex !== undefined && (
                <Pressable
                  style={[
                    styles.continueReadingBtn,
                    {
                      backgroundColor: adaptiveColors.accent + "20",
                      borderColor: adaptiveColors.accent,
                    },
                  ]}
                  onPress={() => {
                    continueReading();
                    setShowTOC(false);
                  }}
                >
                  <Ionicons
                    name="play-circle"
                    size={20}
                    color={adaptiveColors.accent}
                  />
                  <Text
                    style={[
                      styles.continueReadingText,
                      { color: adaptiveColors.accent },
                    ]}
                  >
                    Continue Reading
                  </Text>
                </Pressable>
              )}
              <ScrollView style={styles.modalScrollView}>
                {novel.chapters.map((ch: any, idx: number) => (
                  <Pressable
                    key={idx}
                    style={[
                      styles.tocItem,
                      idx === chapterIndex && [
                        styles.tocItemActive,
                        { backgroundColor: adaptiveColors.accent + "20" },
                      ],
                    ]}
                    onPress={() => handleChapterSelect(idx)}
                  >
                    <View style={styles.tocItemContent}>
                      <Text
                        style={[
                          styles.tocChapterNum,
                          {
                            color:
                              idx === chapterIndex
                                ? adaptiveColors.accent
                                : adaptiveColors.textSecondary,
                          },
                        ]}
                      >
                        Chapter {idx + 1}
                      </Text>
                      <Text
                        style={[
                          styles.tocChapterTitle,
                          {
                            color:
                              idx === chapterIndex
                                ? adaptiveColors.accent
                                : adaptiveColors.text,
                          },
                        ]}
                      >
                        {ch.title}
                      </Text>
                    </View>
                    {idx === chapterIndex && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={adaptiveColors.accent}
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ─── SEARCH MODAL ─── */}
        <Modal
          visible={showSearch}
          animationType="fade"
          transparent
          onRequestClose={() => {
            setShowSearch(false);
            setSearchQuery("");
            setSearchResults([]);
          }}
        >
          <View style={styles.searchModalOverlay}>
            <View
              style={[
                styles.searchModalContent,
                { backgroundColor: adaptiveColors.surface },
              ]}
            >
              <TextInput
                style={[
                  styles.searchInput,
                  {
                    color: adaptiveColors.text,
                    borderColor: adaptiveColors.border,
                    backgroundColor: themeColors.background,
                  },
                ]}
                placeholder="Search chapters..."
                placeholderTextColor={adaptiveColors.textSecondary}
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  searchChapters(text);
                }}
                autoFocus
              />
              {searchResults.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.searchResultCount,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    Found {searchResults.length} chapters
                  </Text>
                  <ScrollView style={{ maxHeight: 300 }}>
                    {searchResults.map((idx) => (
                      <Pressable
                        key={idx}
                        style={[
                          styles.searchResultItem,
                          { borderBottomColor: adaptiveColors.border },
                        ]}
                        onPress={() =>
                          jumpToSearchResult(searchResults.indexOf(idx))
                        }
                      >
                        <Text
                          style={[
                            styles.searchResultTitle,
                            { color: adaptiveColors.text },
                          ]}
                        >
                          {novel?.chapters[idx].title}
                        </Text>
                        <Text
                          style={[
                            styles.searchResultChapter,
                            { color: adaptiveColors.textSecondary },
                          ]}
                        >
                          Chapter {idx + 1}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}
              {searchQuery.length > 0 && searchResults.length === 0 && (
                <Text
                  style={[
                    styles.noResults,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  No chapters found
                </Text>
              )}
              <Pressable
                style={[
                  styles.closeSearchBtn,
                  { backgroundColor: adaptiveColors.card },
                ]}
                onPress={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
              >
                <Text style={{ color: adaptiveColors.text }}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* ─── RAPID‑TAP WARNING MODAL ─── */}
        <Modal
          visible={showRapidTapWarning}
          animationType="fade"
          transparent
          onRequestClose={() => {
            setShowRapidTapWarning(false);
            resetRapidTapGuard();
          }}
        >
          <Pressable
            style={styles.ttsModalOverlay}
            onPress={() => {
              setShowRapidTapWarning(false);
              resetRapidTapGuard();
            }}
          >
            <Pressable
              style={[
                styles.ttsHelpModal,
                { backgroundColor: adaptiveColors.surface },
              ]}
              onPress={() => {}}
            >
              <View
                style={[
                  styles.ttsModalHandle,
                  { backgroundColor: adaptiveColors.border },
                ]}
              />
              <Ionicons
                name="warning-outline"
                size={28}
                color={adaptiveColors.accent}
                style={{ alignSelf: "center", marginBottom: 8 }}
              />
              <Text
                style={[
                  styles.ttsModalTitle,
                  { color: adaptiveColors.text, textAlign: "center" },
                ]}
              >
                You&apos;re tapping a bit fast
              </Text>
              <Text
                style={{
                  color: adaptiveColors.textSecondary,
                  fontSize: 13,
                  textAlign: "center",
                  marginBottom: 20,
                  lineHeight: 18,
                }}
              >
                TTS and auto-scroll have been paused to keep things stable. Give
                it a second, then continue reading.
              </Text>
              <Pressable
                style={[
                  styles.closeSearchBtn,
                  { backgroundColor: adaptiveColors.card },
                ]}
                onPress={() => {
                  setShowRapidTapWarning(false);
                  resetRapidTapGuard();
                }}
              >
                <Text style={{ color: adaptiveColors.text }}>Got it</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ─── DICTIONARY LOOKUP MODAL ─── */}
        <DefinitionModal
          visible={showDictModal}
          word={dictWord}
          entries={dictEntries}
          notFound={dictNotFound}
          onlineEntry={dictOnlineEntry}
          fetching={dictFetching}
          isConnected={dictIsConnected}
          onFetch={handleFetchOnline}
          onDismiss={dismissDictModal}
          onOpenGlossary={() => {
            dismissDictModal();
            setShowGlossaryListModal(true);
          }}
        />

        {/* ─── GLOSSARY LIST MODAL ─── */}
        <GlossaryListModal
          visible={showGlossaryListModal}
          entries={glossary.getAllEntries()}
          onEntryPress={(entry) => {
            // Close glossary list and show definition in the dictionary modal
            setShowGlossaryListModal(false);
            handleWordDoubleTap(entry.word);
          }}
          onDismiss={() => setShowGlossaryListModal(false)}
          onRemoveEntry={glossary.removeEntry}
        />
      </View>
    </ContentWrapper>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  navBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterTitle: { fontSize: 14, flex: 1, textAlign: "center" },
  progressBarContainer: { height: 4, width: "100%", overflow: "hidden" },
  progressBar: { height: "100%", width: "0%" },
  scrollArea: { flex: 1 },
  textContainer: { paddingTop: 20 },
  chapterHeader: { lineHeight: 32, marginBottom: 24, fontWeight: "bold" },
  content: {},
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },

  // ─── Right column wrapper ───
  rightColumn: {
    position: "absolute",
    bottom: 18,
    right: 18,
    alignItems: "center",
    gap: 8,
    zIndex: 17,
  },

  // ─── Fullscreen pill ───
  fullscreenPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },

  // ─── Quick actions cluster ───
  quickActionsCluster: {
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 6,
    elevation: 4,
  },
  quickActionsToggle: {
    width: 28,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ttsPlayBtnInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },

  // ─── TTS overlays ───
  ttsStalledBanner: {
    position: "absolute",
    bottom: 130,
    right: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 3,
  },
  ttsSentenceBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ttsSentenceLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  ttsSentenceText: { fontSize: 13, lineHeight: 19 },

  // ─── Bottom nav ───
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  navChBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  navChText: { fontSize: 13 },
  tocButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 85,
    alignItems: "center",
  },
  tocButtonText: { fontSize: 14 },
  readingPercent: { fontSize: 10, marginTop: 2 },

  // ─── Minimal fullscreen bars ───
  minimalistTopBar: {
    borderBottomWidth: 1,
  },
  minimalistTopBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  minimalistBottomBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
  },

  // ─── Modals ───
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    minHeight: "50%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  modalCloseBtn: { padding: 4 },
  modalScrollView: { paddingHorizontal: 20, paddingVertical: 12 },
  continueReadingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  continueReadingText: { fontSize: 14 },
  tocItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  tocItemActive: { borderRadius: 8 },
  tocItemContent: { flex: 1 },
  tocChapterNum: { fontSize: 12, marginBottom: 4 },
  tocChapterTitle: { fontSize: 14 },
  searchModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  searchModalContent: {
    width: "90%",
    maxHeight: "80%",
    borderRadius: 12,
    padding: 20,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  searchResultCount: { fontSize: 12, marginBottom: 12, textAlign: "center" },
  searchResultItem: { paddingVertical: 12, borderBottomWidth: 1 },
  searchResultTitle: { fontSize: 14, marginBottom: 4 },
  searchResultChapter: { fontSize: 12 },
  noResults: { textAlign: "center", paddingVertical: 20 },
  closeSearchBtn: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  ttsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  ttsModalDismiss: { flex: 1 },
  ttsModalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    marginBottom: 11,
  },
  ttsModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  ttsModalTitle: { fontSize: 17, marginBottom: 20, fontWeight: "bold" },
  ttsModalSubtitle: { fontSize: 14, marginBottom: 12, fontWeight: "600" },
  speedButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  speedButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  speedButtonText: { fontSize: 13, fontWeight: "500" },
  ttsButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 24,
  },
  ttsPreviewBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  ttsSaveBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  ttsReloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginHorizontal: 20,
    borderRadius: 10,
  },
  ttsVoiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    minWidth: 80,
  },
  ttsVoiceChipText: { fontSize: 12, fontWeight: "500" },
  ttsVoiceChipLang: { fontSize: 10, marginTop: 2 },
  ttsHelpModal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    marginBottom: 11,
  },
  ttsHelpItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  ttsHelpIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  ttsHelpTitle: { fontSize: 13, marginBottom: 3, fontWeight: "600" },
  ttsHelpDesc: { fontSize: 12, lineHeight: 17 },
  ttsBackgroundSetupBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  ttsBackgroundSetupBtnText: { fontSize: 12, fontWeight: "600" },
});
