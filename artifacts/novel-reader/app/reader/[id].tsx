import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
  AccessibilityInfo,
  ImageBackground,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const FONT_SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26];
const LINE_SPACINGS = [1.2, 1.3, 1.5, 1.8, 2.0, 2.5];
const AUTO_SCROLL_SPEEDS = [0.5, 1, 1.5, 1.8, 2, 2.5];
const MARGIN_PRESETS = ["Compact", "Comfortable", "Spacious"];

type BgPreset = {
  id: string;
  label: string;
  type: "solid" | "gradient";
  color: string;
  color2?: string;
  textColor: string;
  textColorSecondary: string;
  accentColor?: string;
};

const BG_PRESETS: BgPreset[] = [
  { id: "none", label: "None", type: "solid", color: "transparent", textColor: "#1A1A1A", textColorSecondary: "#666666" },
  { id: "parchment", label: "Parchment", type: "solid", color: "#F2E8D5", textColor: "#2C1810", textColorSecondary: "#8B6914", accentColor: "#8B4513" },
  { id: "night", label: "Night", type: "solid", color: "#0D1117", textColor: "#E8EDF2", textColorSecondary: "#8B949E", accentColor: "#58A6FF" },
  { id: "forest", label: "Forest", type: "solid", color: "#1A2E1A", textColor: "#D4E8D4", textColorSecondary: "#8BA888", accentColor: "#6B8E23" },
  { id: "ocean", label: "Ocean", type: "solid", color: "#0A1628", textColor: "#B8D4E8", textColorSecondary: "#6B8FB3", accentColor: "#4A90E2" },
  { id: "rose", label: "Rose", type: "solid", color: "#2A1020", textColor: "#F0D0E0", textColorSecondary: "#C980A0", accentColor: "#E87DA5" },
  { id: "slate", label: "Slate", type: "solid", color: "#1E2430", textColor: "#D8E0E8", textColorSecondary: "#8B98A8", accentColor: "#7E8A98" },
  { id: "grad_dusk", label: "Dusk", type: "gradient", color: "#1A0533", color2: "#0A1628", textColor: "#D8C8F0", textColorSecondary: "#A890C8", accentColor: "#9B6BFF" },
  { id: "grad_dawn", label: "Dawn", type: "gradient", color: "#2A1008", color2: "#1A0520", textColor: "#F0C8B8", textColorSecondary: "#C89878", accentColor: "#E87D5A" },
  { id: "grad_mist", label: "Mist", type: "gradient", color: "#E8EFF5", color2: "#F5F0E8", textColor: "#2A2A2A", textColorSecondary: "#6B6B6B", accentColor: "#4A6B8A" },
  { id: "grad_moss", label: "Moss", type: "gradient", color: "#1A2810", color2: "#0F1A18", textColor: "#C8E0B0", textColorSecondary: "#90B080", accentColor: "#7CB842" },
  { id: "grad_ember", label: "Ember", type: "gradient", color: "#1A0A00", color2: "#2A0800", textColor: "#F0A080", textColorSecondary: "#C87050", accentColor: "#FF6B3D" },
];

const READER_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/reader_settings.json`;
const TTS_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/tts_simple_settings.json`;
const BG_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/reader_bg.json`;
const TTS_MIN_CHARS = 500;

function isLightColor(color: string): boolean {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}

interface CachedChapter {
  content: string;
  paragraphs: string[];
  sentences: string[];
  processedAt: number;
  wordCount: number;
}

const chapterCache = new Map<string, CachedChapter>();
const CACHE_DURATION = 1000 * 60 * 30;

function detectParagraphs(text: string): string[] {
  let normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim();
  normalized = smartQuoteFormatting(normalized);
  normalized = removeDuplicateSpacing(normalized);

  const patterns = [
    /\n\s*\n+/,
    /\.\n(?=[A-Z])/,
    /[!?]\n(?=[A-Z])/,
    /\n(?=["“'‘])/,
    /\.\s{2,}(?=[A-Z])/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const paragraphs = normalized.split(pattern);
      if (paragraphs.length > 1 && paragraphs.every((p) => p.trim().length > 0)) {
        return paragraphs.map((p) => p.trim()).filter(Boolean);
      }
    }
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/ {2,}/g, " ").trim())
    .filter(Boolean);
}

function smartQuoteFormatting(text: string): string {
  let formatted = text;
  formatted = formatted.replace(/(\s|^)"/g, "$1“");
  formatted = formatted.replace(/"(\s|$)/g, "”$1");
  formatted = formatted.replace(/'(\s|$)/g, "’$1");
  formatted = formatted.replace(/(\s|^)'/g, "$1‘");
  formatted = formatted.replace(/(\w)'(\w)/g, "$1’$2");
  formatted = formatted.replace(/\.{3,}/g, "…");
  formatted = formatted.replace(/--+/g, "—");
  return formatted;
}

function removeDuplicateSpacing(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+(\n)/g, "$1")
    .replace(/(\n)[ \t]+/g, "$1")
    .trim();
}

function splitIntoSentences(text: string): string[] {
  let cleanText = text.replace(/[""'']/g, '"');
  cleanText = cleanText.replace(/→|->|=>|→/g, " to ");
  cleanText = cleanText.replace(/←|<-|<=/g, " from ");
  cleanText = cleanText.replace(/↔|<->/g, " between ");
  const raw = cleanText.match(/[^.!?…\n]+[.!?…]*|[^\n]+/g) ?? [];
  const sentences: string[] = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed.length <= 1) continue;
    if (trimmed.includes("\n") || trimmed.match(/\s{2,}/)) {
      const segments = trimmed.split(/\n+|\s{2,}/).filter((s) => s.trim().length > 0);
      segments.forEach((segment) => {
        const seg = segment.trim();
        if (seg.length >= 2) sentences.push(seg);
      });
    } else {
      const sub = trimmed.match(/[^,;]+[,;]?/g) ?? [trimmed];
      for (const s of sub) {
        const st = s.trim();
        if (st.length >= 2) sentences.push(st);
      }
    }
  }
  return sentences;
}

function splitSentencesWithLineBreaks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘\(\{\[<])/);
  return sentences.filter((s) => s.trim().length > 0);
}

const ContentWrapper = ({ children, bgImageUri, bgSolidColor, defaultBgColor }: any) => {
  if (bgImageUri) {
    return (
      <ImageBackground
        source={{ uri: bgImageUri }}
        style={{ flex: 1 }}
        resizeMode="cover"
        imageStyle={{ width: SCREEN_W, height: SCREEN_H }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}>{children}</View>
      </ImageBackground>
    );
  }
  if (bgSolidColor && bgSolidColor !== "transparent") {
    return <View style={{ flex: 1, backgroundColor: bgSolidColor }}>{children}</View>;
  }
  return <View style={{ flex: 1, backgroundColor: defaultBgColor || "transparent" }}>{children}</View>;
};

export default function ReaderScreen() {
  const { id, chapterIndex: indexParam } = useLocalSearchParams<{ id: string; chapterIndex: string }>();
  const { getNovel, saveReadingProgress, loadChapterContent } = useLibrary();
  const { colors: themeColors } = useTheme();
  const insets = useSafeAreaInsets();

  const [fontSizeIdx, setFontSizeIdx] = useState(3);
  const [lineSpacingIdx, setLineSpacingIdx] = useState(2);
  const [marginPresetIdx, setMarginPresetIdx] = useState(1);
  const [autoScrollSpeedIdx, setAutoScrollSpeedIdx] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBgModal, setShowBgModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [chapterIndex, setChapterIndex] = useState(parseInt(indexParam) || 0);
  const scrollRef = useRef<ScrollView>(null);

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

  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const hasRestoredScrollRef = useRef(false);
  const restoredChapterRef = useRef<number>(-1);

  const [chapterContent, setChapterContent] = useState<string>("");
  const [processedParagraphs, setProcessedParagraphs] = useState<string[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [nextChapterPreloaded, setNextChapterPreloaded] = useState(false);
  const [nextChapterContent, setNextChapterContent] = useState<string>("");

  const [ttsActive, setTtsActive] = useState(false);
  const [ttsSentences, setTtsSentences] = useState<string[]>([]);
  const [ttsIndex, setTtsIndex] = useState(-1);
  const ttsIndexRef = useRef(-1);
  const ttsActiveRef = useRef(false);
  const ttsScrollCounterRef = useRef(0);
  const ttsErrorCountRef = useRef(0);
  const isMountedRef = useRef(true);

  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [showTTSHelp, setShowTTSHelp] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<Speech.Voice[]>([]);
  const [ttsVoiceId, setTtsVoiceId] = useState<string | undefined>(undefined);
  const ttsVoiceIdRef = useRef<string | undefined>(undefined);
  const [ttsRate, setTtsRate] = useState(1.0);
  const ttsRateRef = useRef(1.0);

  const novel = getNovel(id);
  const chapter = novel?.chapters[chapterIndex];
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

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
  const activePreset = BG_PRESETS.find((p) => p.id === bgPresetId);
  const bgImageUri = bgCustomUri ?? null;
  const bgSolidColor = !bgCustomUri && activePreset && activePreset.id !== "none" ? activePreset.color : null;
  const isNoneBackground = !bgCustomUri && activePreset?.id === "none";
  const effectiveBgColor = isNoneBackground ? themeColors.background : "transparent";

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
        surface: isLightColor(activePreset.color) ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.7)",
        card: isLightColor(activePreset.color) ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.6)",
        border: isLightColor(activePreset.color) ? "rgba(0, 0, 0, 0.1)" : "rgba(255, 255, 255, 0.1)",
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
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(READER_SETTINGS_FILE);
        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(READER_SETTINGS_FILE);
          const settings = JSON.parse(content);
          if (settings.fontSizeIdx !== undefined) setFontSizeIdx(settings.fontSizeIdx);
          if (settings.lineSpacingIdx !== undefined) setLineSpacingIdx(settings.lineSpacingIdx);
          if (settings.marginPresetIdx !== undefined) setMarginPresetIdx(settings.marginPresetIdx);
          if (settings.autoScrollSpeedIdx !== undefined) setAutoScrollSpeedIdx(settings.autoScrollSpeedIdx);
        }
      } catch (error) {
        console.error("Failed to load reader settings:", error);
      }

      try {
        const bgInfo = await FileSystem.getInfoAsync(BG_SETTINGS_FILE);
        if (bgInfo.exists) {
          const bgContent = await FileSystem.readAsStringAsync(BG_SETTINGS_FILE);
          const bgSettings = JSON.parse(bgContent);
          if (bgSettings.presetId) setBgPresetId(bgSettings.presetId);
          if (bgSettings.customUri) setBgCustomUri(bgSettings.customUri);
        }
      } catch (e) {
        console.warn("Failed to load bg settings:", e);
      }

      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    updateAdaptiveColors();
  }, [bgPresetId, bgCustomUri, updateAdaptiveColors]);

  const saveAllSettings = async (fontSize: number, lineSpacing: number, margin: number, scroll: number) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        READER_SETTINGS_FILE,
        JSON.stringify({ fontSizeIdx: fontSize, lineSpacingIdx: lineSpacing, marginPresetIdx: margin, autoScrollSpeedIdx: scroll })
      );
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  const saveBgSettings = async (presetId: string, customUri: string | null) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const di = await FileSystem.getInfoAsync(dir);
      if (!di.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(BG_SETTINGS_FILE, JSON.stringify({ presetId, customUri }));
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

  const selectPreset = (preset: BgPreset) => {
    setBgPresetId(preset.id);
    setBgCustomUri(null);
    setShowBgModal(false);
    saveBgSettings(preset.id, null);
  };

  useEffect(() => {
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(TTS_SETTINGS_FILE);
        if (fileInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(TTS_SETTINGS_FILE);
          const s = JSON.parse(raw);
          if (s.voiceId !== undefined) {
            setTtsVoiceId(s.voiceId);
            ttsVoiceIdRef.current = s.voiceId;
          }
          if (s.rate !== undefined) {
            setTtsRate(s.rate);
            ttsRateRef.current = s.rate;
          }
        }
      } catch (e) {
        console.warn("[TTS] Failed to load TTS settings:", e);
      }
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const english = voices.filter((v) => v.language?.toLowerCase().startsWith("en"));
        setTtsVoices(english.length > 0 ? english : voices);
      } catch (e) {
        console.warn("[TTS] Could not load voices:", e);
      }
    })();
  }, []);

  const saveTtsSettings = async (voiceId: string | undefined, rate: number) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(TTS_SETTINGS_FILE, JSON.stringify({ voiceId, rate }));
    } catch (e) {
      console.warn("[TTS] Failed to save settings:", e);
    }
  };

  const processChapterContent = useCallback(
    async (content: string, chapterId: string): Promise<CachedChapter> => {
      const cacheKey = `${novel?.id}_${chapterId}`;
      const cached = chapterCache.get(cacheKey);
      if (cached && Date.now() - cached.processedAt < CACHE_DURATION) return cached;

      const paragraphs = detectParagraphs(content);
      const sentences = splitIntoSentences(content);
      const wordCount = content.split(/\s+/).length;
      const processed: CachedChapter = { content, paragraphs, sentences, processedAt: Date.now(), wordCount };
      chapterCache.set(cacheKey, processed);
      for (const [key, value] of chapterCache.entries()) {
        if (Date.now() - value.processedAt > CACHE_DURATION) chapterCache.delete(key);
      }
      return processed;
    },
    [novel?.id]
  );

  const loadContent = async () => {
    if (novel && chapter) {
      setContentLoading(true);
      try {
        let content = chapter.content || "";
        if (!content && loadChapterContent) {
          const fileChapter = await loadChapterContent(novel.id, chapterIndex);
          content = fileChapter?.content || "";
        }
        const processed = await processChapterContent(content, `${chapterIndex}`);
        setChapterContent(processed.content);
        setProcessedParagraphs(processed.paragraphs);
        setTtsSentences(processed.sentences);

        if (!nextChapterPreloaded && chapterIndex + 1 < novel.chapters.length) {
          const nextChapter = novel.chapters[chapterIndex + 1];
          if (nextChapter && !nextChapter.content) {
            const nextFileChapter = await loadChapterContent(novel.id, chapterIndex + 1);
            if (nextFileChapter?.content) {
              await processChapterContent(nextFileChapter.content, `${chapterIndex + 1}`);
              setNextChapterContent(nextFileChapter.content);
              setNextChapterPreloaded(true);
            }
          }
        }
      } catch (error) {
        setChapterContent("Error loading chapter content. Please try again.");
        setProcessedParagraphs([]);
      } finally {
        setContentLoading(false);
      }
    }
  };

  useEffect(() => {
    loadContent();
  }, [chapterIndex, novel?.id]);

  const searchChapters = useCallback(
    (query: string) => {
      if (!novel) return [];
      const results: number[] = [];
      const lowerQuery = query.toLowerCase();
      novel.chapters.forEach((ch, idx) => {
        if (ch.title.toLowerCase().includes(lowerQuery)) results.push(idx);
      });
      setSearchResults(results);
      return results;
    },
    [novel]
  );

  const jumpToSearchResult = (index: number) => {
    if (searchResults.length > 0 && index < searchResults.length) {
      handleChapterSelect(searchResults[index]);
      setShowSearch(false);
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  const novelRef = useRef(novel);
  const chapterIndexRef = useRef(chapterIndex);
  const chapterRef = useRef(chapter);

  useEffect(() => {
    novelRef.current = novel;
  }, [novel]);
  useEffect(() => {
    chapterIndexRef.current = chapterIndex;
  }, [chapterIndex]);
  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      Speech.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      const n = novelRef.current;
      const ch = chapterRef.current;
      if (n && ch) {
        saveReadingProgress(n.id, chapterIndexRef.current, ch.title, scrollYRef.current);
      }
    };
  }, []);

  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    ttsIndexRef.current = -1;
    ttsScrollCounterRef.current = 0;
    setTtsActive(false);
    setTtsIndex(-1);
    try {
      Speech.stop();
    } catch {}
  }, []);

  useEffect(() => {
    stopTTS();
  }, [chapterIndex]);

  const speakSentence = useCallback(
    (sentences: string[], index: number) => {
      if (!isMountedRef.current) return;
      if (index >= sentences.length || !ttsActiveRef.current) {
        stopTTS();
        return;
      }
      ttsIndexRef.current = index;
      setTtsIndex(index);
      AccessibilityInfo.announceForAccessibility(`Reading: ${sentences[index].substring(0, 100)}`);

      try {
        try {
          Speech.stop();
        } catch {}
        Speech.speak(sentences[index], {
          language: "en",
          pitch: 1.0,
          rate: ttsRateRef.current,
          voice: ttsVoiceIdRef.current,
          onDone: () => {
            if (!isMountedRef.current) return;
            if (!ttsActiveRef.current) return;
            ttsErrorCountRef.current = 0;
            ttsScrollCounterRef.current += 1;
            if (ttsScrollCounterRef.current >= 4) {
              ttsScrollCounterRef.current = 0;
              const newY = scrollYRef.current + 120;
              scrollRef.current?.scrollTo({ y: newY, animated: true });
              scrollYRef.current = newY;
            }
            speakSentence(sentences, index + 1);
          },
          onError: (err) => {
            console.warn("[TTS] Error speaking sentence:", err);
            if (!isMountedRef.current) return;
            if (!ttsActiveRef.current) return;
            ttsErrorCountRef.current += 1;
            if (ttsErrorCountRef.current > 3) {
              stopTTS();
              return;
            }
            speakSentence(sentences, index + 1);
          },
        });
      } catch (err) {
        console.error("[TTS] Unexpected error in speakSentence:", err);
        stopTTS();
      }
    },
    [stopTTS]
  );

  const toggleTTS = useCallback(() => {
    if (ttsActiveRef.current) {
      stopTTS();
      return;
    }
    if (!chapterContent || ttsSentences.length === 0) return;
    setTimeout(() => {
      if (!isMountedRef.current) return;
      if (ttsActiveRef.current) return;
      ttsActiveRef.current = true;
      ttsScrollCounterRef.current = 0;
      setTtsActive(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const scrollRatio = contentHeightRef.current > 0 ? scrollYRef.current / contentHeightRef.current : 0;
      const startIndex = Math.max(0, Math.min(Math.floor(scrollRatio * ttsSentences.length), ttsSentences.length - 1));
      speakSentence(ttsSentences, startIndex);
    }, 100);
  }, [chapterContent, ttsSentences, speakSentence, stopTTS]);

  const previewTts = useCallback(() => {
    if (ttsActiveRef.current) stopTTS();
    setTimeout(() => {
      if (!isMountedRef.current) return;
      try {
        Speech.stop();
        Speech.speak("This is a voice preview.", {
          language: "en",
          pitch: 1.0,
          rate: ttsRateRef.current,
          voice: ttsVoiceIdRef.current,
        });
      } catch (err) {
        console.warn("[TTS] Preview error:", err);
      }
    }, 200);
  }, [stopTTS]);

  const updateReadingProgress = useCallback(() => {
    if (contentHeightRef.current > scrollViewHeightRef.current) {
      const maxScroll = contentHeightRef.current - scrollViewHeightRef.current;
      setReadingProgress(Math.min(100, Math.max(0, (scrollYRef.current / maxScroll) * 100)));
    } else {
      setReadingProgress(0);
    }
  }, []);

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
      const currentY = scrollYRef.current;
      const maxY = Math.max(0, contentHeightRef.current - scrollViewHeightRef.current);
      if (currentY >= maxY) {
        stopAutoScroll();
        return;
      }
      const newY = Math.min(maxY, currentY + (30 * speed) / 20);
      scrollRef.current.scrollTo({ y: newY, animated: false });
      scrollYRef.current = newY;
    }, 50);
    setAutoScrollActive(true);
  }, [autoScrollSpeedIdx, stopAutoScroll]);

  const handleScroll = (event: any) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    updateReadingProgress();
  };

  const handleScrollBeginDrag = () => {
    if (autoScrollActive) stopAutoScroll();
  };

  const handleContentSizeChange = (_width: number, height: number) => {
    contentHeightRef.current = height;
    updateReadingProgress();
    if (!hasRestoredScrollRef.current && restoredChapterRef.current !== chapterIndex) {
      const savedOffset = novel?.lastRead?.chapterIndex === chapterIndex ? novel.lastRead.scrollOffset : 0;
      if (savedOffset > 0 && height > 0) {
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: savedOffset, animated: false });
          scrollYRef.current = savedOffset;
          hasRestoredScrollRef.current = true;
          restoredChapterRef.current = chapterIndex;
          updateReadingProgress();
        }, 80);
      } else {
        hasRestoredScrollRef.current = true;
        restoredChapterRef.current = chapterIndex;
      }
    }
  };

  const handleScrollViewLayout = (event: any) => {
    scrollViewHeightRef.current = event.nativeEvent.layout.height;
    updateReadingProgress();
  };

  const goChapter = (dir: 1 | -1) => {
    const next = chapterIndex + dir;
    if (next < 0 || next >= (novel?.chapters.length ?? 0)) {
      Alert.alert("Navigation", dir === -1 ? "First chapter reached" : "Last chapter reached");
      return;
    }
    if (novel && chapter) saveReadingProgress(novel.id, chapterIndex, chapter.title, scrollYRef.current);
    stopAutoScroll();
    stopTTS();
    scrollYRef.current = 0;
    hasRestoredScrollRef.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChapterIndex(next);
    setReadingProgress(0);
    if (dir === 1 && nextChapterContent) {
      setChapterContent(nextChapterContent);
      setNextChapterPreloaded(false);
    }
  };

  const handleChapterSelect = (index: number) => {
    if (novel && chapter) saveReadingProgress(novel.id, chapterIndex, chapter.title, scrollYRef.current);
    scrollYRef.current = 0;
    hasRestoredScrollRef.current = false;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setChapterIndex(index);
    setShowTOC(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const continueReading = useCallback(() => {
    if (novel?.lastRead && novel.lastRead.chapterIndex !== undefined) {
      setChapterIndex(novel.lastRead.chapterIndex);
      setTimeout(() => {
        if (novel.lastRead.scrollOffset > 0) {
          scrollRef.current?.scrollTo({ y: novel.lastRead.scrollOffset, animated: true });
          scrollYRef.current = novel.lastRead.scrollOffset;
        }
      }, 100);
    }
  }, [novel]);

  const jumpToPercentage = (percentage: number) => {
    if (contentHeightRef.current > scrollViewHeightRef.current) {
      const maxScroll = contentHeightRef.current - scrollViewHeightRef.current;
      const targetY = (percentage / 100) * maxScroll;
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
      scrollYRef.current = targetY;
      updateReadingProgress();
    }
  };

  if (!novel || !chapter || !settingsLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={themeColors.accent} />
      </View>
    );
  }

  const fontSize = FONT_SIZES[fontSizeIdx];
  const lineSpacing = LINE_SPACINGS[lineSpacingIdx];
  const currentSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
  const ttsAvailable = chapterContent.trim().length >= TTS_MIN_CHARS;
  const currentSentence = ttsIndex >= 0 ? ttsSentences[ttsIndex] : null;

  return (
    <ContentWrapper bgImageUri={bgImageUri} bgSolidColor={bgSolidColor} defaultBgColor={themeColors.background}>
      <View style={[styles.container, { backgroundColor: effectiveBgColor }]}>
        {/* Top bar */}
        <View
          style={[
            styles.topBar,
            {
              paddingTop: topPad + 4,
              backgroundColor: adaptiveColors.surface,
              borderBottomColor: adaptiveColors.border,
            },
          ]}
        >
          <Pressable style={styles.navBtn} onPress={() => router.back()} accessibilityLabel="Close reader">
            <Ionicons name="close" size={22} color={adaptiveColors.text} />
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => setShowSettingsSheet(false)}>
            <Text style={[styles.chapterTitle, { color: adaptiveColors.text }]} numberOfLines={1}>
              {chapter.title}
            </Text>
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => setShowSettingsSheet(true)} accessibilityLabel="Reader settings">
            <Ionicons name="settings-outline" size={20} color={adaptiveColors.text} />
          </Pressable>
        </View>

        {/* Progress indicator */}
        <Pressable
          style={[styles.progressBarContainer, { backgroundColor: adaptiveColors.border }]}
          onPress={(e) => {
            const { locationX } = e.nativeEvent;
            const percentage = (locationX / SCREEN_W) * 100;
            jumpToPercentage(percentage);
          }}
          accessibilityLabel={`Reading progress ${Math.round(readingProgress)} percent`}
        >
          <View style={[styles.progressBar, { backgroundColor: adaptiveColors.accent, width: `${readingProgress}%` }]} />
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
                paddingBottom: bottomPad + 100,
              },
            ]}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
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
                {processedParagraphs.map((paragraph, paraIdx) => {
                  const sentences = splitSentencesWithLineBreaks(paragraph);
                  const isLastParagraph = paraIdx === processedParagraphs.length - 1;
                  return (
                    <View key={paraIdx} style={{ marginBottom: isLastParagraph ? 0 : fontSize * 1.5 }}>
                      {sentences.map((sentence, sentIdx) => {
                        const trimmed = sentence.trim();
                        const endsWithPeriod = /[.!?]$/.test(trimmed);
                        const isExclamation = /[!?]$/.test(trimmed);
                        const isQuestion = /\?$/.test(trimmed);
                        let marginBottom = fontSize * 0.3;
                        if (isQuestion) marginBottom = fontSize * 0.7;
                        else if (isExclamation) marginBottom = fontSize * 0.8;
                        else if (endsWithPeriod) marginBottom = fontSize * 0.5;
                        const hasDialogue = /^["'“”‘’]/.test(trimmed);
                        if (hasDialogue && sentIdx > 0) marginBottom += fontSize * 0.2;

                        let isCurrentSentence = false;
                        const normalizedSentence = trimmed.replace(/[""'']/g, '"');
                        if (ttsIndex >= 0 && ttsSentences[ttsIndex]) {
                          const currentTtsSentence = ttsSentences[ttsIndex].replace(/[""'']/g, '"');
                          if (normalizedSentence.includes(currentTtsSentence) || currentTtsSentence.includes(normalizedSentence)) {
                            isCurrentSentence = true;
                          }
                        }
                        return (
                          <Text
                            key={sentIdx}
                            style={[
                              styles.content,
                              {
                                color: isCurrentSentence ? adaptiveColors.accent : adaptiveColors.text,
                                backgroundColor: isCurrentSentence ? `${adaptiveColors.accent}20` : "transparent",
                                fontSize,
                                lineHeight: fontSize * lineSpacing,
                                marginBottom,
                                paddingVertical: isCurrentSentence ? 2 : 0,
                                paddingHorizontal: isCurrentSentence ? 6 : 0,
                                borderRadius: 6,
                                letterSpacing: 0.2,
                              },
                            ]}
                          >
                            {trimmed}
                          </Text>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Quick jump buttons */}
          <Pressable
            style={[styles.jumpTopBtn, { backgroundColor: adaptiveColors.card + "CC", borderColor: adaptiveColors.border }]}
            onPress={() => {
              scrollRef.current?.scrollTo({ y: 0, animated: true });
              scrollYRef.current = 0;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }}
          >
            <Ionicons name="arrow-up" size={16} color={adaptiveColors.text} />
          </Pressable>

          {/* TTS Help Button */}
          {ttsAvailable && (
            <Pressable
              style={[styles.ttsHelpBtn, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
              onPress={() => setShowTTSHelp(true)}
            >
              <Ionicons name="book-outline" size={20} color={adaptiveColors.text} />
            </Pressable>
          )}

          {/* TTS Floating Button */}
          {ttsAvailable && (
            <Pressable
              style={[styles.ttsFloatingBtn, { backgroundColor: adaptiveColors.accent }]}
              onPress={toggleTTS}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                setShowTTSSettings(true);
              }}
              delayLongPress={400}
            >
              <Ionicons name={ttsActive ? "pause" : "volume-high"} size={22} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* TTS status overlay */}
        {ttsActive && currentSentence && (
          <View
            style={[
              styles.ttsSentenceBox,
              { backgroundColor: adaptiveColors.accent + "12", borderColor: adaptiveColors.accent + "40" },
            ]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={adaptiveColors.accent} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.ttsSentenceLabel, { color: adaptiveColors.accent }]}>Now reading</Text>
              <Text style={[styles.ttsSentenceText, { color: adaptiveColors.text }]} numberOfLines={2}>
                {currentSentence.length > 100 ? currentSentence.substring(0, 100) + "..." : currentSentence}
              </Text>
            </View>
          </View>
        )}

        {/* Bottom navigation */}
        <View
          style={[
            styles.bottomNav,
            {
              backgroundColor: adaptiveColors.surface,
              borderTopColor: adaptiveColors.border,
              paddingBottom: bottomPad + 8,
            },
          ]}
        >
          <Pressable
            style={[
              styles.navChBtn,
              {
                backgroundColor: chapterIndex === 0 ? adaptiveColors.border : adaptiveColors.card,
                borderColor: adaptiveColors.border,
              },
            ]}
            onPress={() => goChapter(-1)}
            disabled={chapterIndex === 0}
          >
            <Ionicons name="chevron-back" size={18} color={chapterIndex === 0 ? adaptiveColors.textSecondary : adaptiveColors.text} />
            <Text style={[styles.navChText, { color: chapterIndex === 0 ? adaptiveColors.textSecondary : adaptiveColors.text }]}>Prev</Text>
          </Pressable>
          <Pressable style={[styles.tocButton, { borderColor: adaptiveColors.border }]} onPress={() => setShowTOC(true)}>
            <Text style={[styles.tocButtonText, { color: adaptiveColors.text }]}>
              {chapterIndex + 1} / {novel.chapters.length}
            </Text>
            <Text style={[styles.readingPercent, { color: adaptiveColors.textSecondary }]}>{Math.round(readingProgress)}%</Text>
          </Pressable>
          <Pressable
            style={[
              styles.navChBtn,
              {
                backgroundColor: chapterIndex === novel.chapters.length - 1 ? adaptiveColors.border : adaptiveColors.accent,
                borderColor: chapterIndex === novel.chapters.length - 1 ? adaptiveColors.border : adaptiveColors.accent,
              },
            ]}
            onPress={() => goChapter(1)}
            disabled={chapterIndex === novel.chapters.length - 1}
          >
            <Text
              style={[
                styles.navChText,
                { color: chapterIndex === novel.chapters.length - 1 ? adaptiveColors.textSecondary : "#fff" },
              ]}
            >
              Next
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={chapterIndex === novel.chapters.length - 1 ? adaptiveColors.textSecondary : "#fff"}
            />
          </Pressable>
        </View>

        {/* ========== SETTINGS BOTTOM SHEET ========== */}
        <Modal visible={showSettingsSheet} animationType="fade" transparent onRequestClose={() => setShowSettingsSheet(false)}>
          <Pressable style={styles.overlayDismiss} onPress={() => setShowSettingsSheet(false)}>
            <Pressable
              style={[styles.settingsSheet, { backgroundColor: adaptiveColors.surface, borderColor: adaptiveColors.border }]}
              onPress={() => {}}
            >
              <View style={[styles.sheetHandle, { backgroundColor: adaptiveColors.border }]} />
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
                {/* Font Size */}
                <Text style={[styles.sectionLabel, { color: adaptiveColors.textSecondary }]}>Font Size</Text>
                <View style={styles.controlRow}>
                  <Pressable
                    style={[styles.controlBtn, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                    onPress={() => {
                      const newIdx = Math.max(0, fontSizeIdx - 1);
                      setFontSizeIdx(newIdx);
                      saveAllSettings(newIdx, lineSpacingIdx, marginPresetIdx, autoScrollSpeedIdx);
                    }}
                  >
                    <Text style={[styles.controlBtnText, { color: adaptiveColors.text, fontSize: 12 }]}>A</Text>
                  </Pressable>
                  <Text style={[styles.controlValue, { color: adaptiveColors.text }]}>{fontSize}pt</Text>
                  <Pressable
                    style={[styles.controlBtn, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                    onPress={() => {
                      const newIdx = Math.min(FONT_SIZES.length - 1, fontSizeIdx + 1);
                      setFontSizeIdx(newIdx);
                      saveAllSettings(newIdx, lineSpacingIdx, marginPresetIdx, autoScrollSpeedIdx);
                    }}
                  >
                    <Text style={[styles.controlBtnText, { color: adaptiveColors.text, fontSize: 18 }]}>A</Text>
                  </Pressable>
                </View>

                {/* Line Spacing */}
                <Text style={[styles.sectionLabel, { color: adaptiveColors.textSecondary, marginTop: 12 }]}>Line Spacing</Text>
                <View style={styles.controlRow}>
                  <Pressable
                    style={[styles.controlBtn, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                    onPress={() => {
                      const newIdx = Math.max(0, lineSpacingIdx - 1);
                      setLineSpacingIdx(newIdx);
                      saveAllSettings(fontSizeIdx, newIdx, marginPresetIdx, autoScrollSpeedIdx);
                    }}
                  >
                    <Ionicons name="remove" size={16} color={adaptiveColors.text} />
                  </Pressable>
                  <Text style={[styles.controlValue, { color: adaptiveColors.text }]}>{lineSpacing.toFixed(1)}x</Text>
                  <Pressable
                    style={[styles.controlBtn, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                    onPress={() => {
                      const newIdx = Math.min(LINE_SPACINGS.length - 1, lineSpacingIdx + 1);
                      setLineSpacingIdx(newIdx);
                      saveAllSettings(fontSizeIdx, newIdx, marginPresetIdx, autoScrollSpeedIdx);
                    }}
                  >
                    <Ionicons name="add" size={16} color={adaptiveColors.text} />
                  </Pressable>
                </View>

                {/* Margins */}
                <Text style={[styles.sectionLabel, { color: adaptiveColors.textSecondary, marginTop: 12 }]}>Margins</Text>
                <View style={styles.marginRow}>
                  {MARGIN_PRESETS.map((preset, idx) => (
                    <Pressable
                      key={preset}
                      style={[
                        styles.marginPresetBtn,
                        {
                          backgroundColor: marginPresetIdx === idx ? adaptiveColors.accent : adaptiveColors.card,
                          borderColor: adaptiveColors.border,
                        },
                      ]}
                      onPress={() => {
                        setMarginPresetIdx(idx);
                        saveAllSettings(fontSizeIdx, lineSpacingIdx, idx, autoScrollSpeedIdx);
                      }}
                    >
                      <Text style={[styles.marginPresetText, { color: marginPresetIdx === idx ? "#fff" : adaptiveColors.text }]}>
                        {preset}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Background */}
                <Text style={[styles.sectionLabel, { color: adaptiveColors.textSecondary, marginTop: 12 }]}>Background</Text>
                <View style={styles.bgRow}>
                  <Pressable
                    style={[styles.bgCurrentBtn, { borderColor: adaptiveColors.border, backgroundColor: adaptiveColors.card }]}
                    onPress={pickCustomImage}
                  >
                    {bgCustomUri ? (
                      <Image source={{ uri: bgCustomUri }} style={styles.bgCurrentImage} resizeMode="cover" />
                    ) : bgSolidColor && bgSolidColor !== "transparent" ? (
                      <View style={[styles.bgCurrentImage, { backgroundColor: bgSolidColor }]} />
                    ) : (
                      <View style={styles.bgCurrentEmpty}>
                        <Ionicons name="image-outline" size={22} color={adaptiveColors.textSecondary} />
                        <Text style={[styles.bgCurrentLabel, { color: adaptiveColors.textSecondary }]}>Custom</Text>
                      </View>
                    )}
                    <Text style={[styles.bgBtnLabel, { color: adaptiveColors.textSecondary }]}>Current Image</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.bgPresetsBtn, { borderColor: adaptiveColors.border, backgroundColor: adaptiveColors.card }]}
                    onPress={() => setShowBgModal(true)}
                  >
                    <View style={styles.bgPresetsGrid}>
                      {BG_PRESETS.slice(1, 5).map((p) => (
                        <View key={p.id} style={[styles.bgPresetsGridCell, { backgroundColor: p.color }]} />
                      ))}
                    </View>
                    <Text style={[styles.bgBtnLabel, { color: adaptiveColors.textSecondary }]}>Presets</Text>
                  </Pressable>
                </View>

                {/* Auto‑Scroll */}
                <Text style={[styles.sectionLabel, { color: adaptiveColors.textSecondary, marginTop: 12 }]}>Auto‑Scroll</Text>
                <View style={styles.autoScrollRow}>
                  <Pressable
                    style={[
                      styles.autoScrollPlayBtn,
                      {
                        backgroundColor: autoScrollActive ? adaptiveColors.accent : adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => (autoScrollActive ? stopAutoScroll() : startAutoScroll())}
                  >
                    <Ionicons name={autoScrollActive ? "pause" : "play"} size={16} color={autoScrollActive ? "#fff" : adaptiveColors.text} />
                    <Text style={[styles.autoScrollText, { color: autoScrollActive ? "#fff" : adaptiveColors.text }]}>
                      {autoScrollActive ? "Pause" : "Start"}
                    </Text>
                  </Pressable>
                  <View style={styles.speedControl}>
                    <Pressable
                      style={[styles.controlBtnSmall, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                      onPress={() => {
                        const newIdx = Math.max(0, autoScrollSpeedIdx - 1);
                        setAutoScrollSpeedIdx(newIdx);
                        saveAllSettings(fontSizeIdx, lineSpacingIdx, marginPresetIdx, newIdx);
                      }}
                    >
                      <Ionicons name="remove" size={14} color={adaptiveColors.text} />
                    </Pressable>
                    <Text style={[styles.controlValueSmall, { color: adaptiveColors.text }]}>{currentSpeed.toFixed(1)}x</Text>
                    <Pressable
                      style={[styles.controlBtnSmall, { backgroundColor: adaptiveColors.card, borderColor: adaptiveColors.border }]}
                      onPress={() => {
                        const newIdx = Math.min(AUTO_SCROLL_SPEEDS.length - 1, autoScrollSpeedIdx + 1);
                        setAutoScrollSpeedIdx(newIdx);
                        saveAllSettings(fontSizeIdx, lineSpacingIdx, marginPresetIdx, newIdx);
                      }}
                    >
                      <Ionicons name="add" size={14} color={adaptiveColors.text} />
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Background Presets Modal (nested) */}
        <Modal visible={showBgModal} animationType="slide" transparent onRequestClose={() => setShowBgModal(false)}>
          <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
            <View style={[styles.modalContent, { backgroundColor: adaptiveColors.surface }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: adaptiveColors.text }]}>Background Presets</Text>
                <Pressable onPress={() => setShowBgModal(false)} style={styles.modalCloseBtn}>
                  <Ionicons name="close" size={24} color={adaptiveColors.text} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.bgPresetsList}>
                {BG_PRESETS.map((preset) => {
                  const isActive = bgPresetId === preset.id && !bgCustomUri;
                  return (
                    <Pressable
                      key={preset.id}
                      style={[
                        styles.bgPresetItem,
                        { borderColor: isActive ? adaptiveColors.accent : adaptiveColors.border, borderWidth: isActive ? 2 : 1 },
                      ]}
                      onPress={() => selectPreset(preset)}
                    >
                      <View style={[styles.bgPresetSwatch, { backgroundColor: preset.color, overflow: "hidden" }]}>
                        {preset.type === "gradient" && preset.color2 && (
                          <View
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: "50%",
                              backgroundColor: preset.color2,
                            }}
                          />
                        )}
                      </View>
                      <Text style={[styles.bgPresetLabel, { color: isActive ? adaptiveColors.accent : adaptiveColors.text }]}>
                        {preset.label}
                      </Text>
                      {isActive && <Ionicons name="checkmark-circle" size={18} color={adaptiveColors.accent} />}
                    </Pressable>
                  );
                })}
                <Pressable
                  style={[
                    styles.bgPresetItem,
                    { borderColor: bgCustomUri ? adaptiveColors.accent : adaptiveColors.border, borderWidth: bgCustomUri ? 2 : 1 },
                  ]}
                  onPress={pickCustomImage}
                >
                  <View
                    style={[
                      styles.bgPresetSwatch,
                      { backgroundColor: adaptiveColors.card, alignItems: "center", justifyContent: "center" },
                    ]}
                  >
                    {bgCustomUri ? (
                      <Image source={{ uri: bgCustomUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    ) : (
                      <Ionicons name="add" size={22} color={adaptiveColors.textSecondary} />
                    )}
                  </View>
                  <Text style={[styles.bgPresetLabel, { color: bgCustomUri ? adaptiveColors.accent : adaptiveColors.text }]}>
                    {bgCustomUri ? "Custom (tap to change)" : "Pick from Gallery"}
                  </Text>
                  {bgCustomUri && <Ionicons name="checkmark-circle" size={18} color={adaptiveColors.accent} />}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* TTS Help Modal */}
        <Modal visible={showTTSHelp} animationType="fade" transparent onRequestClose={() => setShowTTSHelp(false)}>
          <Pressable style={styles.ttsModalOverlay} onPress={() => setShowTTSHelp(false)}>
            <Pressable style={[styles.ttsHelpModal, { backgroundColor: adaptiveColors.surface }]} onPress={() => {}}>
              <View style={[styles.ttsModalHandle, { backgroundColor: adaptiveColors.border }]} />
              <Text style={[styles.ttsModalTitle, { color: adaptiveColors.text }]}>How to Use Text-to-Speech</Text>
              {[
                { icon: "volume-high", title: "Start / Pause Reading", desc: "Tap the speaker button to start TTS. Tap again to pause." },
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
                  <View style={[styles.ttsHelpIconWrap, { backgroundColor: adaptiveColors.accent + "20" }]}>
                    <Ionicons name={icon as any} size={18} color={adaptiveColors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ttsHelpTitle, { color: adaptiveColors.text }]}>{title}</Text>
                    <Text style={[styles.ttsHelpDesc, { color: adaptiveColors.textSecondary }]}>{desc}</Text>
                  </View>
                </View>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* TTS Settings Modal */}
        <Modal visible={showTTSSettings} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setShowTTSSettings(false)}>
          <View style={styles.ttsModalOverlay}>
            <Pressable style={styles.ttsModalDismiss} onPress={() => setShowTTSSettings(false)} />
            <View style={[styles.ttsModalSheet, { backgroundColor: adaptiveColors.surface }]}>
              <View style={[styles.ttsModalHandle, { backgroundColor: adaptiveColors.border }]} />
              {ttsVoices.length === 0 ? (
                <>
                  <Text style={[styles.ttsModalTitle, { color: adaptiveColors.text, textAlign: "center" }]}>No Engines Found</Text>
                  <Pressable
                    style={[styles.ttsReloadBtn, { backgroundColor: adaptiveColors.accent }]}
                    onPress={async () => {
                      try {
                        const voices = await Speech.getAvailableVoicesAsync();
                        const english = voices.filter((v) => v.language?.toLowerCase().startsWith("en"));
                        setTtsVoices(english.length > 0 ? english : voices);
                      } catch (e) {
                        console.warn(e);
                      }
                    }}
                  >
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={{ color: "#fff", fontWeight: "600", marginLeft: 8 }}>Reload Engines</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={[styles.ttsModalSubtitle, { color: adaptiveColors.text }]}>Voice Speed</Text>
                  <View style={styles.speedButtonsRow}>
                    {[0.5, 1.0, 1.5, 2.0, 2.5].map((rate) => (
                      <Pressable
                        key={rate}
                        style={[
                          styles.speedButton,
                          {
                            backgroundColor: Math.abs(ttsRate - rate) < 0.01 ? adaptiveColors.accent : adaptiveColors.card,
                            borderColor: adaptiveColors.border,
                          },
                        ]}
                        onPress={() => {
                          setTtsRate(rate);
                          ttsRateRef.current = rate;
                          saveTtsSettings(ttsVoiceId, rate);
                        }}
                      >
                        <Text
                          style={[
                            styles.speedButtonText,
                            { color: Math.abs(ttsRate - rate) < 0.01 ? "#fff" : adaptiveColors.text },
                          ]}
                        >
                          {rate}x
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[styles.ttsModalSubtitle, { color: adaptiveColors.text, marginTop: 16 }]}>Voices</Text>
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
                              backgroundColor: isSelected ? adaptiveColors.accent : adaptiveColors.card,
                              borderColor: isSelected ? adaptiveColors.accent : adaptiveColors.border,
                            },
                          ]}
                          onPress={() => {
                            setTtsVoiceId(voice.identifier);
                            ttsVoiceIdRef.current = voice.identifier;
                            saveTtsSettings(voice.identifier, ttsRate);
                          }}
                        >
                          <Text style={[styles.ttsVoiceChipText, { color: isSelected ? "#fff" : adaptiveColors.text }]}>
                            {voice.name ?? voice.identifier}
                          </Text>
                          <Text style={[styles.ttsVoiceChipLang, { color: isSelected ? "rgba(255,255,255,0.7)" : adaptiveColors.textSecondary }]}>
                            {voice.language}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.ttsButtonsRow}>
                    <Pressable style={[styles.ttsPreviewBtn, { borderColor: adaptiveColors.accent }]} onPress={previewTts}>
                      <Ionicons name="play-circle-outline" size={20} color={adaptiveColors.accent} />
                      <Text style={{ color: adaptiveColors.accent, marginLeft: 6 }}>Preview Voice</Text>
                    </Pressable>
                    <Pressable style={[styles.ttsSaveBtn, { backgroundColor: adaptiveColors.accent }]} onPress={() => setShowTTSSettings(false)}>
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Save Values</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* TOC Modal */}
        <Modal visible={showTOC} animationType="slide" transparent onRequestClose={() => setShowTOC(false)}>
          <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
            <View style={[styles.modalContent, { backgroundColor: adaptiveColors.surface }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: adaptiveColors.text }]}>Table of Contents</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable onPress={() => setShowSearch(true)} style={styles.modalCloseBtn}>
                    <Ionicons name="search" size={24} color={adaptiveColors.text} />
                  </Pressable>
                  <Pressable onPress={() => setShowTOC(false)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={24} color={adaptiveColors.text} />
                  </Pressable>
                </View>
              </View>
              {novel.lastRead && novel.lastRead.chapterIndex !== undefined && (
                <Pressable
                  style={[
                    styles.continueReadingBtn,
                    { backgroundColor: adaptiveColors.accent + "20", borderColor: adaptiveColors.accent },
                  ]}
                  onPress={() => {
                    continueReading();
                    setShowTOC(false);
                  }}
                >
                  <Ionicons name="play-circle" size={20} color={adaptiveColors.accent} />
                  <Text style={[styles.continueReadingText, { color: adaptiveColors.accent }]}>Continue Reading</Text>
                </Pressable>
              )}
              <ScrollView style={styles.modalScrollView}>
                {novel.chapters.map((ch, idx) => (
                  <Pressable
                    key={idx}
                    style={[
                      styles.tocItem,
                      idx === chapterIndex && [styles.tocItemActive, { backgroundColor: adaptiveColors.accent + "20" }],
                    ]}
                    onPress={() => handleChapterSelect(idx)}
                  >
                    <View style={styles.tocItemContent}>
                      <Text
                        style={[
                          styles.tocChapterNum,
                          { color: idx === chapterIndex ? adaptiveColors.accent : adaptiveColors.textSecondary },
                        ]}
                      >
                        Chapter {idx + 1}
                      </Text>
                      <Text style={[styles.tocChapterTitle, { color: idx === chapterIndex ? adaptiveColors.accent : adaptiveColors.text }]}>
                        {ch.title}
                      </Text>
                    </View>
                    {idx === chapterIndex && <Ionicons name="checkmark-circle" size={20} color={adaptiveColors.accent} />}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Search Modal */}
        <Modal visible={showSearch} animationType="fade" transparent onRequestClose={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}>
          <View style={styles.searchModalOverlay}>
            <View style={[styles.searchModalContent, { backgroundColor: adaptiveColors.surface }]}>
              <TextInput
                style={[
                  styles.searchInput,
                  { color: adaptiveColors.text, borderColor: adaptiveColors.border, backgroundColor: adaptiveColors.background },
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
                  <Text style={[styles.searchResultCount, { color: adaptiveColors.textSecondary }]}>
                    Found {searchResults.length} chapters
                  </Text>
                  <ScrollView style={{ maxHeight: 300 }}>
                    {searchResults.map((idx) => (
                      <Pressable
                        key={idx}
                        style={[styles.searchResultItem, { borderBottomColor: adaptiveColors.border }]}
                        onPress={() => jumpToSearchResult(searchResults.indexOf(idx))}
                      >
                        <Text style={[styles.searchResultTitle, { color: adaptiveColors.text }]}>{novel?.chapters[idx].title}</Text>
                        <Text style={[styles.searchResultChapter, { color: adaptiveColors.textSecondary }]}>Chapter {idx + 1}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}
              {searchQuery.length > 0 && searchResults.length === 0 && (
                <Text style={[styles.noResults, { color: adaptiveColors.textSecondary }]}>No chapters found</Text>
              )}
              <Pressable
                style={[styles.closeSearchBtn, { backgroundColor: adaptiveColors.card }]}
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
      </View>
    </ContentWrapper>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chapterTitle: { fontSize: 14, flex: 1, textAlign: "center" },
  progressBarContainer: { height: 4, width: "100%", overflow: "hidden" },
  progressBar: { height: "100%", width: "0%" },
  scrollArea: { flex: 1 },
  textContainer: { paddingTop: 20 },
  chapterHeader: { lineHeight: 32, marginBottom: 24, fontWeight: "bold" },
  content: {},
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  jumpTopBtn: {
    position: "absolute",
    bottom: 74,
    left: 18,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    elevation: 3,
  },
  ttsHelpBtn: {
    position: "absolute",
    bottom: 74,
    right: 18,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    elevation: 3,
  },
  ttsFloatingBtn: {
    position: "absolute",
    bottom: 20,
    right: 18,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  ttsSentenceBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ttsSentenceLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  ttsSentenceText: { fontSize: 13, lineHeight: 19 },
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  navChBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  navChText: { fontSize: 13 },
  tocButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, minWidth: 85, alignItems: "center" },
  tocButtonText: { fontSize: 14 },
  readingPercent: { fontSize: 10, marginTop: 2 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", minHeight: "50%" },
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
  // Sheet styles
  overlayDismiss: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  settingsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: "80%",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  controlBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1 },
  controlBtnText: { fontWeight: "600" },
  controlValue: { fontSize: 15, width: 50, textAlign: "center" },
  marginRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  marginPresetBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  marginPresetText: { fontSize: 13, fontWeight: "500" },
  bgRow: { flexDirection: "row", gap: 12, marginBottom: 8 },
  bgCurrentBtn: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  bgCurrentImage: { width: "100%", height: 60 },
  bgCurrentEmpty: { height: 60, alignItems: "center", justifyContent: "center", gap: 4 },
  bgCurrentLabel: { fontSize: 10 },
  bgBtnLabel: { fontSize: 11, textAlign: "center", paddingVertical: 6 },
  bgPresetsBtn: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  bgPresetsGrid: { flexDirection: "row", flexWrap: "wrap", height: 60 },
  bgPresetsGridCell: { width: "50%", height: "50%" },
  autoScrollRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  autoScrollPlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 30,
    borderWidth: 1,
  },
  autoScrollText: { fontSize: 13, fontWeight: "500" },
  speedControl: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  controlBtnSmall: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1 },
  controlValueSmall: { fontSize: 14, width: 40, textAlign: "center" },
  bgPresetsList: { paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  bgPresetItem: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 10, padding: 10 },
  bgPresetSwatch: { width: 48, height: 48, borderRadius: 8, overflow: "hidden" },
  bgPresetLabel: { fontSize: 14, fontWeight: "500", flex: 1 },
  searchModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  searchModalContent: { width: "90%", maxHeight: "80%", borderRadius: 12, padding: 20 },
  searchInput: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16 },
  searchResultCount: { fontSize: 12, marginBottom: 12, textAlign: "center" },
  searchResultItem: { paddingVertical: 12, borderBottomWidth: 1 },
  searchResultTitle: { fontSize: 14, marginBottom: 4 },
  searchResultChapter: { fontSize: 12 },
  noResults: { textAlign: "center", paddingVertical: 20 },
  closeSearchBtn: { marginTop: 16, padding: 12, borderRadius: 8, alignItems: "center" },
  ttsModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  ttsModalDismiss: { flex: 1 },
  ttsModalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    marginBottom: 11,
  },
  ttsModalHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  ttsModalTitle: { fontSize: 17, marginBottom: 20, fontWeight: "bold" },
  ttsModalSubtitle: { fontSize: 14, marginBottom: 12, fontWeight: "600" },
  speedButtonsRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  speedButton: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  speedButtonText: { fontSize: 13, fontWeight: "500" },
  ttsButtonsRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 24 },
  ttsPreviewBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  ttsSaveBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10 },
  ttsReloadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginHorizontal: 20, borderRadius: 10 },
  ttsVoiceChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", minWidth: 80 },
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
  ttsHelpItem: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 },
  ttsHelpIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2 },
  ttsHelpTitle: { fontSize: 13, marginBottom: 3, fontWeight: "600" },
  ttsHelpDesc: { fontSize: 12, lineHeight: 17 },
});