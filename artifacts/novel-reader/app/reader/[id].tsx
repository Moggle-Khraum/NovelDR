import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
  AccessibilityInfo,
  ImageBackground,
  Image,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import {
  updateMediaSession,
  clearMediaSession,
  setupMediaSession,
  setRemoteHandlers,
} from "@/lib/TTSMediaSession";
import * as Notifications from "expo-notifications";
import * as KeepAwake from "expo-keep-awake";
import notifee, { AuthorizationStatus } from "@notifee/react-native";

const { width: SCREEN_W } = Dimensions.get("window");

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
  {
    id: "none",
    label: "None",
    type: "solid",
    color: "transparent",
    textColor: "#1A1A1A",
    textColorSecondary: "#666666",
  },
  {
    id: "parchment",
    label: "Parchment",
    type: "solid",
    color: "#F2E8D5",
    textColor: "#2C1810",
    textColorSecondary: "#8B6914",
    accentColor: "#8B4513",
  },
  {
    id: "night",
    label: "Night",
    type: "solid",
    color: "#0D1117",
    textColor: "#E8EDF2",
    textColorSecondary: "#8B949E",
    accentColor: "#58A6FF",
  },
  {
    id: "forest",
    label: "Forest",
    type: "solid",
    color: "#1A2E1A",
    textColor: "#D4E8D4",
    textColorSecondary: "#8BA888",
    accentColor: "#6B8E23",
  },
  {
    id: "ocean",
    label: "Ocean",
    type: "solid",
    color: "#0A1628",
    textColor: "#B8D4E8",
    textColorSecondary: "#6B8FB3",
    accentColor: "#4A90E2",
  },
  {
    id: "rose",
    label: "Rose",
    type: "solid",
    color: "#2A1020",
    textColor: "#F0D0E0",
    textColorSecondary: "#C980A0",
    accentColor: "#E87DA5",
  },
  {
    id: "slate",
    label: "Slate",
    type: "solid",
    color: "#1E2430",
    textColor: "#D8E0E8",
    textColorSecondary: "#8B98A8",
    accentColor: "#7E8A98",
  },
  {
    id: "grad_dusk",
    label: "Dusk",
    type: "gradient",
    color: "#1A0533",
    color2: "#0A1628",
    textColor: "#D8C8F0",
    textColorSecondary: "#A890C8",
    accentColor: "#9B6BFF",
  },
  {
    id: "grad_dawn",
    label: "Dawn",
    type: "gradient",
    color: "#2A1008",
    color2: "#1A0520",
    textColor: "#F0C8B8",
    textColorSecondary: "#C89878",
    accentColor: "#E87D5A",
  },
  {
    id: "grad_mist",
    label: "Mist",
    type: "gradient",
    color: "#E8EFF5",
    color2: "#F5F0E8",
    textColor: "#2A2A2A",
    textColorSecondary: "#6B6B6B",
    accentColor: "#4A6B8A",
  },
  {
    id: "grad_moss",
    label: "Moss",
    type: "gradient",
    color: "#1A2810",
    color2: "#0F1A18",
    textColor: "#C8E0B0",
    textColorSecondary: "#90B080",
    accentColor: "#7CB842",
  },
  {
    id: "grad_ember",
    label: "Ember",
    type: "gradient",
    color: "#1A0A00",
    color2: "#2A0800",
    textColor: "#F0A080",
    textColorSecondary: "#C87050",
    accentColor: "#FF6B3D",
  },
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

function detectParagraphs(text: string): string[] {
  let normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim();
  normalized = smartQuoteFormatting(normalized);
  normalized = removeDuplicateSpacing(normalized);
  normalized = stripDotLeaders(normalized);
  normalized = isolateStatLabels(normalized);
  normalized = isolateRuleHeadings(normalized);
  normalized = isolateBracketBlocks(normalized);

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
      if (
        paragraphs.length > 1 &&
        paragraphs.every((p) => p.trim().length > 0)
      ) {
        return paragraphs.map((p) => p.trim()).filter(Boolean);
      }
    }
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph.replace(/\n+/g, " ").replace(/ {2,}/g, " ").trim(),
    )
    .filter(Boolean);
}

// Decorative dot/ellipsis "leaders" used as a visual scene-break in raw
// source text — e.g. "…………" or "..........." sitting between two
// sentences with no other separator. These carry no meaning (unlike a
// normal 3-dot "..." trailing-off ellipsis in dialogue, which we leave
// alone) — they're just noise once real paragraph breaks are in place.
// Only strips runs of 4+ dot/ellipsis characters to avoid touching
// legitimate short ellipses.
function stripDotLeaders(text: string): string {
  return text
    .replace(/[.\u2026]{4,}/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// "Character stat block" dumps ("[Strangeness Level]: S-level Overall
// Rating: 95 points [Strategy Index]: ★★★★★ [Height]: 172cm 【weight】:
// ??kg ...") pack several "Label: value" fields onto one glued line, with
// no punctuation or 3+ word content inside the brackets to trip the
// isolateBracketBlocks differentiator — "[Height]" and "[weight]" are
// just single words. What actually marks these as data fields (not a
// narrative aside like "the giant [rare] item") is the colon
// immediately following the bracket. So: a bracket (ASCII [ ] or
// full-width 【 】) directly followed by ":" always starts a new line,
// regardless of word count. We also break before short, unbracketed
// Title-Case labels (e.g. "Overall Rating:") when what follows the
// colon looks like a value (a number, a star rating, or another
// capitalized word) — this catches the plain labels sitting between
// bracketed ones in the same stat dump without matching ordinary
// dialogue-attribution colons like `she said: "..."`.
function isolateStatLabels(text: string): string {
  let result = text.replace(
    /(?:\[[^\[\]]*\]|【[^【】]*】)\s*:/g,
    (match) => `\n\n${match}`,
  );
  result = result.replace(
    /\b[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*){0,3}\s*:\s*(?=[\d★☆]|[A-Z][a-zA-Z])/g,
    (match) => `\n\n${match}`,
  );
  // A run of rating stars (e.g. "★★★★★") is a value, not a label, so the
  // above passes don't touch it — but it usually marks the tail end of a
  // stat block, with prose narration resuming right after ("[Danger
  // Level]: ★★★★★ Lin Feng subconsciously swallowed..."). Break after the
  // stars so that narration starts on its own line. Skip when the stars
  // are immediately followed by another label (already gets its own
  // break above) to avoid an extra blank paragraph.
  result = result.replace(
    /([★☆]+)[ \t]+(?!\n|\[|【)/g,
    (_match, stars) => `${stars}\n\n`,
  );
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

// "Rule Two: [Irregular Gifts]" style labeled headings (common in
// "system"/rulebook-style novels) show up glued mid-paragraph in the raw
// text, e.g. "...filled with terror. Rule Two: [Irregular Gifts] The
// flight attendant continued...". These function as section headings,
// not just a bracket aside, so — unlike a bare inline bracket — they
// always get isolated onto their own paragraph line regardless of the
// word-count/punctuation differentiator used for plain brackets. Runs
// before isolateBracketBlocks so the heading's bracket is consumed here
// and not re-evaluated by the plainer bracket rule.
function isolateRuleHeadings(text: string): string {
  return text
    .replace(
      /\s*(\bRule\s+[A-Za-z0-9]+\s*:\s*(?:\[[^\[\]]*\]|【[^【】]*】)?)\s*/g,
      "\n\n$1\n\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// System/status messages in system-style novels ("[Suitable host detected...]",
// "[Congratulations, host!]", etc.) are frequently glued directly onto
// surrounding narrative text with no blank line or sentence break in the
// raw source — see the "Chapter 1" screenshots where a wall of bracketed
// callouts all run together as one paragraph. Force every such block onto
// its own paragraph line (blank line before and after) so each bracket
// reads as a separate beat instead of merging into the prose around it.
// Runs BEFORE the sentence-boundary patterns below so a bracket forces a
// break even mid-sentence, regardless of punctuation.
//
// Differentiator: only isolate brackets that actually look like a system
// message — 3+ words, or internal punctuation (a comma/period/!/?/:/;) —
// not short inline asides like "the giant [rare] item" or an item name
// like "[Legendary Sword]", which stay glued into their sentence.
function isolateBracketBlocks(text: string): string {
  return text
    .replace(/\[[^\[\]]*\]|【[^【】]*】/g, (match) => {
      const inner = match.slice(1, -1).trim();
      const wordCount = inner.split(/\s+/).filter(Boolean).length;
      const isSystemMessage = wordCount >= 3 || /[.,!?:;]/.test(inner);
      return isSystemMessage ? `\n\n${match}\n\n` : match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

// Cleans up a single sentence for speech synthesis (symbol pronunciation,
// smart-quote normalization). This is applied AFTER splitting, on top of
// the exact same per-paragraph splitSentencesWithLineBreaks() output the
// renderer uses for highlighting — never as an independent split of the
// raw content. Two independent splitters (this one used to run its own
// regex-based chunking over the whole chapter, separately from the
// per-paragraph splitter used for on-screen highlighting) drift apart
// after enough sentences, since their boundary rules aren't identical.
// Once that drift exceeds the highlight mapper's lookahead window, the
// highlight silently stops resolving for the rest of the chapter, even
// though narration keeps playing — this is what caused highlights to
// disappear a minute or so into a chapter. Deriving both TTS and render
// sentences from one splitter makes that class of bug impossible: index i
// in ttsSentences always corresponds to the exact same sentence as index i
// in the flattened paragraphSentences.
function normalizeForSpeech(text: string): string {
  let clean = text.replace(/[""'']/g, '"');
  clean = clean.replace(/→|->|=>/g, " to ");
  clean = clean.replace(/←|<-|<=/g, " from ");
  clean = clean.replace(/↔|<->/g, " between ");
  return clean.trim();
}

function splitSentencesWithLineBreaks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘\(\{\[<])/);
  return sentences.filter((s) => s.trim().length > 0);
}

// ── ParagraphBlock ───────────────────────────────────────────────────────────
// Renders a single paragraph as its own small component, memoized so that
// only the paragraph containing the active TTS sentence re-renders when
// ttsIndex/currentHighlightKey advances, instead of the entire sentence
// tree across every paragraph in the chapter. This is a fallback mitigation
// for the RN new-architecture scheduler SIGSEGV (RuntimeScheduler_Modern)
// caused by rendering hundreds of individually-updating <Text> nodes.
type ParagraphBlockProps = {
  sentences: string[];
  paraIdx: number;
  highlightedSentIdx: number; // -1 if no sentence in this paragraph is active
  isLastParagraph: boolean;
  fontSize: number;
  lineSpacing: number;
  accentColor: string;
  textColor: string;
  contentStyle: any;
  onParaLayout: (paraIdx: number, y: number, height: number) => void;
  // Fires only for the sentence matching highlightedSentIdx — every other
  // sentence in the tree has no onLayout at all. Keeps the guard tight:
  // at most 1 extra native layout callback active at any time, not O(sentences).
  onHighlightedSentenceLayout: (relY: number) => void;
};

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
    onParaLayout,
    onHighlightedSentenceLayout,
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
          const hasDialogue = /^["'“”‘’]/.test(trimmed);
          if (hasDialogue && sentIdx > 0) marginBottom += fontSize * 0.2;

          const isHighlighted = sentIdx === highlightedSentIdx;

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
                  fontWeight: isHighlighted ? "bold" : "normal",
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
              {trimmed}
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
    prev.textColor === next.textColor,
);

// ── Rapid-tap guard ──────────────────────────────────────────────────────────
// Tracks tap timestamps and flags when 4+ taps land within RAPID_TAP_WINDOW_MS.
// This is a workaround, not a fix: it reduces the odds of hitting the
// scheduler/Skia crashes by removing "user mashing buttons" as a contributing
// factor, but a long chapter + sustained TTS alone can still stress the
// scheduler without any taps at all.
const RAPID_TAP_THRESHOLD = 4;
const RAPID_TAP_WINDOW_MS = 1500;

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

const ContentWrapper = ({
  children,
  bgImageUri,
  bgSolidColor,
  defaultBgColor,
}: any) => {
  if (bgImageUri) {
    return (
      <ImageBackground
        source={{ uri: bgImageUri }}
        style={{ flex: 1 }}
        resizeMode="cover"
        imageStyle={{ flex: 1 }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}>
          {children}
        </View>
      </ImageBackground>
    );
  }
  if (bgSolidColor && bgSolidColor !== "transparent") {
    return (
      <View style={{ flex: 1, backgroundColor: bgSolidColor }}>{children}</View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: defaultBgColor || "transparent" }}>
      {children}
    </View>
  );
};

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

  const [fontSizeIdx, setFontSizeIdx] = useState(3);
  const [lineSpacingIdx, setLineSpacingIdx] = useState(2);
  const fontSize = FONT_SIZES[fontSizeIdx];
  const lineSpacing = LINE_SPACINGS[lineSpacingIdx];
  const [marginPresetIdx, setMarginPresetIdx] = useState(1);
  const [autoScrollSpeedIdx, setAutoScrollSpeedIdx] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBgModal, setShowBgModal] = useState(false);
  const [showRapidTapWarning, setShowRapidTapWarning] = useState(false);
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
  // True while the user has a finger on the ScrollView (or shortly after
  // lifting it), used to suppress the TTS follow-scroll effect below so it
  // doesn't fight a manual scroll gesture.
  const isUserScrollingRef = useRef(false);
  const userScrollResumeTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasRestoredScrollRef = useRef(false);
  const restoredChapterRef = useRef<number>(-1);
  const restoreAttemptsRef = useRef(0);
  const lastRestoreHeightRef = useRef(0);
  const restoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the on-screen Y position of each paragraph and each sentence within it,
  // populated via onLayout (cheap, fires once per layout, not per render).
  // Used to scroll precisely to the sentence currently being read by TTS.
  const paraYPositionsRef = useRef<Map<number, number>>(new Map());
  const paraHeightsRef = useRef<Map<number, number>>(new Map());
  // Tracks the on-screen Y position of ONLY the sentence currently
  // highlighted by TTS (relative to its paragraph). Deliberately not a Map
  // of every sentence — only the active <Text> gets an onLayout callback at
  // any given time (see ParagraphBlock), so this stays O(1) instead of
  // reintroducing the O(sentences) layout-event flood that caused the
  // RN new-arch scheduler SIGSEGV.
  const highlightedSentenceRelYRef = useRef<number | null>(null);

  const [chapterContent, setChapterContent] = useState<string>("");
  const [processedParagraphs, setProcessedParagraphs] = useState<string[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  // NOTE: written to below (setNextChapterContent/setNextChapterPreloaded) as part of
  // a next-chapter preload, but never read anywhere — looks like an unfinished
  // "instant transition" feature rather than something safe to delete outright.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [nextChapterPreloaded, setNextChapterPreloaded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [nextChapterContent, setNextChapterContent] = useState<string>("");

  const [ttsActive, setTtsActive] = useState(false);
  const [ttsSentences, setTtsSentences] = useState<string[]>([]);
  const [ttsIndex, setTtsIndex] = useState(-1);
  const ttsIndexRef = useRef(-1);
  const ttsActiveRef = useRef(false);
  const ttsScrollCounterRef = useRef(0);
  const ttsErrorCountRef = useRef(0);
  const isMountedRef = useRef(true);

  // --- TTS stall watchdog state ---
  const [ttsStalled, setTtsStalled] = useState(false);
  const ttsStalledRef = useRef(false);
  const ttsStallRetryCountRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [showTTSHelp, setShowTTSHelp] = useState(false);

  // --- Quick-actions cluster (collapsible floating button group) ---
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(true);

  // --- Optional background-playback setup (notification + battery) ---
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
      // isBatteryOptimizationEnabled() true means the OS IS restricting the
      // app (i.e. NOT exempt) — invert for a "good state = true" reading.
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
      console.warn("[BackgroundSetup] Notification permission request failed:", e);
    }
    // Re-check afterwards — if the user already permanently denied it
    // before, the OS prompt won't reappear and this fetch just confirms
    // that, so the button below can fall back to opening app settings.
    await refreshBackgroundSetupStatus();
  }, [refreshBackgroundSetupStatus]);

  const handleOpenBatteryOptimizationSettings = useCallback(async () => {
    try {
      await notifee.openBatteryOptimizationSettings();
    } catch (e) {
      console.warn("[BackgroundSetup] Could not open battery optimization settings:", e);
    }
  }, []);

  const handleOpenPowerManagerSettings = useCallback(async () => {
    try {
      await notifee.openPowerManagerSettings();
    } catch (e) {
      console.warn("[BackgroundSetup] Could not open power manager settings:", e);
    }
  }, []);
  const [ttsVoices, setTtsVoices] = useState<Speech.Voice[]>([]);
  const [ttsVoiceId, setTtsVoiceId] = useState<string | undefined>(undefined);
  const ttsVoiceIdRef = useRef<string | undefined>(undefined);
  const [ttsRate, setTtsRate] = useState(1.0);
  const ttsRateRef = useRef(1.0);

  // ─── TTS Auto Next ──────────────────────────────────────────────────────
  // When on, once TTS naturally finishes reading the last sentence of a
  // chapter, a short countdown fires "Next" automatically and (if content
  // loads successfully) resumes TTS on the new chapter — so listening can
  // continue hands-free across chapter boundaries.
  const [ttsAutoNext, setTtsAutoNext] = useState(false);
  const ttsAutoNextRef = useRef(false);
  const [autoNextCountdownActive, setAutoNextCountdownActive] = useState(false);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextResumeRef = useRef(false);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNextCountdownActive(false);
  }, []);

  const toggleTtsAutoNext = useCallback(() => {
    setTtsAutoNext((prev) => {
      const next = !prev;
      ttsAutoNextRef.current = next;
      if (!next) cancelAutoNext();
      saveTtsSettings(ttsVoiceIdRef.current, ttsRateRef.current, next);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [cancelAutoNext]);

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

      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    updateAdaptiveColors();
  }, [bgPresetId, bgCustomUri, updateAdaptiveColors]);

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
        }),
      );
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

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
          if (s.autoNext !== undefined) {
            setTtsAutoNext(!!s.autoNext);
            ttsAutoNextRef.current = !!s.autoNext;
          }
        }
      } catch (e) {
        console.warn("[TTS] Failed to load TTS settings:", e);
      }
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const english = voices.filter((v) =>
          v.language?.toLowerCase().startsWith("en"),
        );
        setTtsVoices(english.length > 0 ? english : voices);
      } catch (e) {
        console.warn("[TTS] Could not load voices:", e);
      }
    })();
  }, []);

  const saveTtsSettings = async (
    voiceId: string | undefined,
    rate: number,
    autoNext?: boolean,
  ) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        TTS_SETTINGS_FILE,
        JSON.stringify({
          voiceId,
          rate,
          autoNext: autoNext ?? ttsAutoNextRef.current,
        }),
      );
    } catch (e) {
      console.warn("[TTS] Failed to save settings:", e);
    }
  };

  const processChapterContent = useCallback(
    async (content: string): Promise<CachedChapter> => {
      if (!content.trim()) {
        return {
          content: "",
          paragraphs: [],
          sentences: [],
          processedAt: Date.now(),
          wordCount: 0,
        };
      }

      const paragraphs = detectParagraphs(content);
      const sentences = paragraphs.flatMap((p) =>
        splitSentencesWithLineBreaks(p).map(normalizeForSpeech),
      );
      const wordCount = content.split(/\s+/).length;
      return {
        content,
        paragraphs,
        sentences,
        processedAt: Date.now(),
        wordCount,
      };
    },
    [],
  );

  // ─── Memoized sentence splitting & TTS↔render mapping ──────────────────
  // Splitting every paragraph into render-sentences used to happen INSIDE the
  // render function on every single re-render (including every scroll event
  // and every autoscroll tick, since those trigger setReadingProgress).
  // That meant hundreds of regex operations running dozens of times per
  // second — a major, needless CPU/battery cost. Now it's computed once
  // whenever the chapter's paragraphs actually change.
  const paragraphSentences = useMemo(
    () => processedParagraphs.map((p) => splitSentencesWithLineBreaks(p)),
    [processedParagraphs],
  );

  // Maps each ttsSentences[] index to the render-sentence key ("paraIdx-sentIdx")
  // that visually corresponds to it. ttsSentences is derived from the exact
  // same per-paragraph split as paragraphSentences (see processChapterContent),
  // so this is a direct structural correspondence, not a text-matching guess —
  // no drift is possible, and there's no lookahead window to fall outside of.
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

  // Clear stale layout measurements whenever the chapter's paragraphs change,
  // so old y-positions from a previous chapter can't be scrolled to.
  useEffect(() => {
    paraYPositionsRef.current.clear();
    paraHeightsRef.current.clear();
  }, [processedParagraphs]);

  // The paragraph index currently being read by TTS. Derived from
  // currentHighlightKey so the scroll effect below can key off paragraph
  // changes only, not every individual sentence within the same paragraph.
  const currentParaIdx = currentHighlightKey
    ? parseInt(currentHighlightKey.split("-")[0], 10)
    : -1;

  // Reset the tracked offset whenever the highlight moves — otherwise the
  // scroll effect below could briefly use last sentence's relY for one
  // frame before the new sentence's onLayout fires.
  useEffect(() => {
    highlightedSentenceRelYRef.current = null;
  }, [currentHighlightKey]);

  // Bumped whenever the highlighted sentence's layout is measured, so the
  // scroll effect below re-runs with the fresh offset even though it lives
  // in a ref (refs don't trigger effects on their own).
  const [highlightLayoutVersion, setHighlightLayoutVersion] = useState(0);

  // Stable across renders so ParagraphBlock's React.memo isn't defeated by
  // a freshly-created function identity on every parent re-render.
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

  // Auto-scroll to follow the highlight as TTS reads. Triggers on every
  // highlight change (currentHighlightKey), not just paragraph changes, so
  // the scroll position tracks the actual sentence being spoken instead of
  // jumping once per paragraph and then sitting still while the highlight
  // drifts further down the block.
  useEffect(() => {
    if (!ttsActive || currentParaIdx < 0 || !currentHighlightKey) return;
    if (isUserScrollingRef.current) return;
    const paraY = paraYPositionsRef.current.get(currentParaIdx);
    if (paraY === undefined) return; // Only the currently-highlighted sentence is ever measured (see
    // ParagraphBlock), so this ref always reflects the active sentence's
    // offset within its paragraph — not stale data from a different one.
    const sentenceRelY = highlightedSentenceRelYRef.current;
    const targetCenter = paraY + (sentenceRelY ?? 0);

    // Offset by ~2 text-block heights so the highlighted line lands above
    // dead-center, clear of the TTS status overlay and floating buttons
    // docked at the bottom of the screen.
    const blockHeightEstimate = fontSize * lineSpacing * 1.8;
    const centerOffset = blockHeightEstimate * 2;
    const targetY = Math.max(
      0,
      targetCenter - scrollViewHeightRef.current / 2 + centerOffset,
    );
    scrollRef.current?.scrollTo({ y: targetY, animated: true });
    scrollYRef.current = targetY;
  }, [
    currentHighlightKey,
    currentParaIdx,
    ttsIndex,
    ttsSentences,
    ttsActive,
    fontSize,
    lineSpacing,
    highlightLayoutVersion,
  ]);

  // ─── Load effect with AbortController and request ID ──────────────────
  const loadIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const preloadedIndexRef = useRef<number>(-1);

  // Intentionally keyed off chapterIndex/novel?.id (stable primitives), not the
  // chapter/novel object refs, which can change identity on unrelated re-renders.
  // Depending on the objects would re-trigger this load (spinner + fetch)
  // whenever that happens, not just on actual chapter navigation.
  useEffect(() => {
    // Create a new AbortController for this load
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    // Increment the request ID
    const currentLoadId = ++loadIdRef.current;

    // If the novel or chapter is missing, clear content and stop loading
    if (!novel || !chapter) {
      setChapterContent("");
      setProcessedParagraphs([]);
      setTtsSentences([]);
      setContentLoading(false);
      return;
    }

    // Reset content and show loading spinner immediately
    setChapterContent("");
    setProcessedParagraphs([]);
    setTtsSentences([]);
    setContentLoading(true);

    const load = async () => {
      try {
        // Check abort signal before any async work
        if (signal.aborted || currentLoadId !== loadIdRef.current) return;

        // Attempt to load chapter content from the novel object or from disk
        let content = chapter.content || "";
        if (!content && loadChapterContent) {
          const fileChapter = await loadChapterContent(novel.id, chapterIndex);
          if (signal.aborted || currentLoadId !== loadIdRef.current) return;
          content = fileChapter?.content || "";
        }

        // Process the content fresh every time (no caching)
        const processed = await processChapterContent(content);
        if (signal.aborted || currentLoadId !== loadIdRef.current) return;

        // Update state with the processed content
        setChapterContent(processed.content);
        setProcessedParagraphs(processed.paragraphs);
        setTtsSentences(processed.sentences);

        // If this chapter change was triggered by TTS Auto Next, resume
        // reading aloud from the top of the new chapter once it's ready.
        if (autoNextResumeRef.current) {
          autoNextResumeRef.current = false;
          if (processed.sentences.length > 0) {
            setTimeout(() => {
              if (!isMountedRef.current) return;
              if (signal.aborted || currentLoadId !== loadIdRef.current) return;
              ttsActiveRef.current = true;
              ttsScrollCounterRef.current = 0;
              setTtsActive(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              speakSentence(processed.sentences, 0);
            }, 150);
          }
        }

        // Preload the next chapter's raw content if not already preloaded for this chapterIndex
        if (
          preloadedIndexRef.current !== chapterIndex &&
          chapterIndex + 1 < novel.chapters.length
        ) {
          preloadedIndexRef.current = chapterIndex; // mark before awaiting so it can't re-enter
          const nextChapter = novel.chapters[chapterIndex + 1];
          if (nextChapter && !nextChapter.content) {
            const nextFileChapter = await loadChapterContent(
              novel.id,
              chapterIndex + 1,
            );
            if (signal.aborted || currentLoadId !== loadIdRef.current) return;
            if (nextFileChapter?.content) {
              setNextChapterContent(nextFileChapter.content);
              setNextChapterPreloaded(true);
            }
          }
        }
      } catch {
        if (!signal.aborted && currentLoadId === loadIdRef.current) {
          setChapterContent("Error loading chapter content. Please try again.");
          setProcessedParagraphs([]);
        }
      } finally {
        if (!signal.aborted && currentLoadId === loadIdRef.current) {
          setContentLoading(false);
        }
      }
    };

    load();

    // Cleanup: abort the current request and mark as cancelled
    return () => {
      abortController.abort();
    };
    // chapter/novel object refs intentionally omitted, see comment above.
    // speakSentence is also intentionally omitted: it's declared further
    // down in this component, so referencing it directly in this array
    // (unlike inside the deferred `load` closure above, which is safe)
    // trips a TS "used before declaration" error. Its identity is stable
    // in practice (memoized on stopTTS/clearWatchdogTimer only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, novel?.id, loadChapterContent, processChapterContent]);

  // ─── Search ────────────────────────────────────────────────────────────
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
    [novel],
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
  const chapterContentRef = useRef<string>("");
  const appStateRef = useRef(AppState.currentState);
  const persistSnapshotRef = useRef({ index: chapterIndex, content: "" });

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
    chapterContentRef.current = chapterContent;
  }, [chapterContent]);
  useEffect(() => {
    persistSnapshotRef.current = {
      index: chapterIndex,
      content: chapterContent,
    };
  }, [chapterIndex, chapterContent]);

  // ─── Save chapter content to disk ────────────────────────────────────
  const persistChapterContent = useCallback(async () => {
    const n = novelRef.current;
    const ch = chapterRef.current;
    const { index, content } = persistSnapshotRef.current;

    if (!n || !ch || !content) return;
    if (index !== chapterIndexRef.current) return; // stale pairing guard

    try {
      await saveChapterContent(
        n.id,
        index,
        ch.title,
        ch.url,
        content,
        ch.chapterNumber,
      );
      console.log(
        `[Reader] Chapter content persisted: ${n.title} - Chapter ${index}`,
      );
    } catch (error) {
      console.warn(`[Reader] Failed to persist chapter content:`, error);
    }
  }, [saveChapterContent]);

  // ─── Persist on unmount and background ──────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      Speech.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      if (userScrollResumeTimeoutRef.current)
        clearTimeout(userScrollResumeTimeoutRef.current);
      // Clear watchdog timer
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      // Cancel any pending auto-next notifications
      Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});

      const n = novelRef.current;
      const ch = chapterRef.current;
      if (n && ch) {
        saveReadingProgress(
          n.id,
          chapterIndexRef.current,
          ch.title,
          scrollYRef.current,
        );
        persistChapterContent();
      }
    };
  }, [persistChapterContent, saveReadingProgress]);

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        (appStateRef.current === "active" &&
          nextAppState.match(/inactive|background/)) ||
        nextAppState === "background"
      ) {
        console.log("[Reader] App backgrounding - saving chapter content...");
        await persistChapterContent();

        // Also persist the current scroll position (including wherever TTS's
        // follow-scroll has gotten to) so that if the OS kills the process
        // while backgrounded — which can happen even with the TTS foreground
        // service running — resuming lands back where narration actually
        // left off instead of an older, stale scrollOffset from the last
        // chapter change or manual close.
        const n = novelRef.current;
        const ch = chapterRef.current;
        if (n && ch) {
          saveReadingProgress(
            n.id,
            chapterIndexRef.current,
            ch.title,
            scrollYRef.current,
          );
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
    };
  }, [persistChapterContent, saveReadingProgress]);

  // ─── Notification setup ───────────────────────────────────────────────
  useEffect(() => {
    setupMediaSession();
  }, []);

  // ── Watchdog timer helpers ──────────────────────────────────────────
  const clearWatchdogTimer = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  // ─── TTS methods ──────────────────────────────────────────────────────
  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    ttsIndexRef.current = -1;
    ttsScrollCounterRef.current = 0;
    setTtsActive(false);
    setTtsIndex(-1);
    clearWatchdogTimer();
    ttsStalledRef.current = false;
    setTtsStalled(false);
    ttsStallRetryCountRef.current = 0;
    try {
      KeepAwake.deactivateKeepAwake();
    } catch {}
    try {
      Speech.stop();
    } catch {}
  }, [clearWatchdogTimer]);

  const speakSentence = useCallback(
    (sentences: string[], index: number) => {
      if (!isMountedRef.current) return;
      if (index >= sentences.length || !ttsActiveRef.current) {
        const finishedNaturally =
          index >= sentences.length && ttsActiveRef.current;
        stopTTS();
        if (
          finishedNaturally &&
          ttsAutoNextRef.current &&
          novelRef.current &&
          chapterIndexRef.current + 1 < novelRef.current.chapters.length
        ) {
          if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
          setAutoNextCountdownActive(true);
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});

          // Announce next chapter via TTS
          try {
            Speech.speak("Loading next chapter", {
              language: "en",
              pitch: 1.0,
              rate: ttsRateRef.current,
              voice: ttsVoiceIdRef.current,
            });
          } catch {}

          // Schedule background-safe notification for auto-next
          (async () => {
            try {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: "Chapter Complete",
                  body: "Moving to next chapter in 3 seconds...",
                  sound: false,
                  data: { action: "auto_next_chapter" },
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes
                    .TIME_INTERVAL,
                  seconds: 3,
                  repeats: false,
                },
              });
            } catch (e) {
              console.warn("[Auto-Next] Failed to schedule notification:", e);
            }
          })();

          // Keep local timer for on-screen countdown UI
          autoNextTimerRef.current = setTimeout(() => {
            autoNextTimerRef.current = null;
            setAutoNextCountdownActive(false);
            if (!isMountedRef.current || !ttsAutoNextRef.current) return;
            autoNextResumeRef.current = true;
            goChapterRef.current(1);
          }, 3000);
        }
        return;
      }
      ttsIndexRef.current = index;
      setTtsIndex(index);

      // Clear any previous watchdog timer
      clearWatchdogTimer();

      // Estimate duration for watchdog
      const wordCount = sentences[index].split(/\s+/).length;
      // Rough estimate: ~3 words per second at 1x, multiply by 2.5 margin, min 5 seconds
      const estimatedDuration = Math.max(
        5,
        (wordCount / 3) * (1 / ttsRateRef.current) * 2.5,
      );

      // Set watchdog timer
      watchdogTimerRef.current = setTimeout(() => {
        // Check if we're still on the same sentence and TTS is active
        if (!ttsActiveRef.current || ttsIndexRef.current !== index) {
          return; // not our turn anymore
        }
        // We have a stall
        if (ttsStallRetryCountRef.current < 1) {
          // First stall: retry once
          ttsStallRetryCountRef.current += 1;
          console.log("[TTS] Watchdog: retrying stalled sentence");
          // Retry by calling speakSentence again with the same index
          clearWatchdogTimer(); // clear this timer
          speakSentence(sentences, index);
        } else {
          // Retries exhausted: mark stalled
          console.warn("[TTS] Watchdog: stalled permanently");
          ttsStalledRef.current = true;
          setTtsStalled(true);
          // Stop any audio and stop the loop
          ttsActiveRef.current = false;
          setTtsActive(false);
          try {
            Speech.stop();
          } catch {}
          clearWatchdogTimer();
        }
      }, estimatedDuration * 1000);

      AccessibilityInfo.announceForAccessibility(
        `Reading: ${sentences[index].substring(0, 100)}`,
      );

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
            // Clear watchdog and reset retry counter on success
            clearWatchdogTimer();
            ttsStallRetryCountRef.current = 0;
            ttsErrorCountRef.current = 0;
            speakSentence(sentences, index + 1);
          },
          onError: (err) => {
            console.warn("[TTS] Error speaking sentence:", err);
            if (!isMountedRef.current) return;
            if (!ttsActiveRef.current) return;
            clearWatchdogTimer();
            ttsErrorCountRef.current += 1;
            if (ttsErrorCountRef.current > 3) {
              stopTTS();
              return;
            }
            // On error, skip the sentence (as before)
            speakSentence(sentences, index + 1);
          },
        });
      } catch (err) {
        console.error("[TTS] Unexpected error in speakSentence:", err);
        stopTTS();
      }
    },
    [stopTTS, clearWatchdogTimer],
  );

  const toggleTTS = useCallback(() => {
    if (ttsActiveRef.current) {
      stopTTS();
      return;
    }
    // If stalled, resume from current index
    if (ttsStalledRef.current && ttsIndexRef.current >= 0) {
      ttsStalledRef.current = false;
      setTtsStalled(false);
      ttsStallRetryCountRef.current = 0;
      ttsActiveRef.current = true;
      setTtsActive(true);
      clearWatchdogTimer();
      // Resume from current index
      if (ttsIndexRef.current < ttsSentences.length) {
        speakSentence(ttsSentences, ttsIndexRef.current);
      } else {
        // If index out of range, restart from beginning
        if (ttsSentences.length > 0) {
          speakSentence(ttsSentences, 0);
        }
      }
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
      const scrollRatio =
        contentHeightRef.current > 0
          ? scrollYRef.current / contentHeightRef.current
          : 0;
      const startIndex = Math.max(
        0,
        Math.min(
          Math.floor(scrollRatio * ttsSentences.length),
          ttsSentences.length - 1,
        ),
      );
      speakSentence(ttsSentences, startIndex);
    }, 100);
  }, [chapterContent, ttsSentences, speakSentence, stopTTS, clearWatchdogTimer]);

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

  // ─── Scrolling / progress ─────────────────────────────────────────────
  const updateReadingProgress = useCallback(() => {
    if (contentHeightRef.current > scrollViewHeightRef.current) {
      const maxScroll = contentHeightRef.current - scrollViewHeightRef.current;
      setReadingProgress(
        Math.min(100, Math.max(0, (scrollYRef.current / maxScroll) * 100)),
      );
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

  // Rapid-tap guard: workaround for the RN new-arch scheduler SIGSEGV and the
  // Android 16 Skia/libhwui crash, both of which are made more likely by
  // concurrent state updates from mashing buttons while TTS/auto-scroll are
  // actively re-rendering the sentence tree. Tripping this pauses playback
  // and surfaces a warning rather than letting taps pile up unbounded.
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

  const startAutoScroll = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const speed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
    intervalRef.current = setInterval(() => {
      if (!scrollRef.current) return;
      const currentY = scrollYRef.current;
      const maxY = Math.max(
        0,
        contentHeightRef.current - scrollViewHeightRef.current,
      );
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

  const USER_SCROLL_RESUME_DELAY = 2500;

  const handleScrollBeginDrag = () => {
    if (autoScrollActive) stopAutoScroll();
    isUserScrollingRef.current = true;
    if (userScrollResumeTimeoutRef.current) {
      clearTimeout(userScrollResumeTimeoutRef.current);
      userScrollResumeTimeoutRef.current = null;
    }
  };

  // Give the TTS follow-scroll a short grace period after the user lets go
  // (rather than resuming the instant the finger lifts) so a quick flick to
  // re-read a line doesn't get immediately yanked back by the next
  // highlight tick.
  const handleScrollEndDrag = () => {
    if (userScrollResumeTimeoutRef.current)
      clearTimeout(userScrollResumeTimeoutRef.current);
    userScrollResumeTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      userScrollResumeTimeoutRef.current = null;
    }, USER_SCROLL_RESUME_DELAY);
  };

  // Restoring scroll position is tricky because content renders progressively —
  // paragraphs, TTS sentence splitting, and layout can all cause the ScrollView's
  // content height to grow across several onContentSizeChange events. A single
  // early attempt can get silently clamped by the native view if the content
  // isn't tall enough yet to reach the saved offset, leaving the reader stuck
  // near the top while the progress bar (driven by scrollYRef) still reports
  // the intended percentage. To fix that, we retry on every content-size change
  // until the content is tall enough to actually contain the saved offset, or
  // the height stops changing (rendering has settled), or we hit a max attempt
  // count — and we always clamp scrollYRef to what was actually achievable so
  // the progress bar never lies about where the view really is.
  const MAX_RESTORE_ATTEMPTS = 10;
  const RESTORE_SETTLE_DELAY = 100;

  const handleContentSizeChange = (_width: number, height: number) => {
    contentHeightRef.current = height;
    updateReadingProgress();

    if (
      hasRestoredScrollRef.current ||
      restoredChapterRef.current === chapterIndex
    )
      return;

    const savedOffset =
      novel?.lastRead?.chapterIndex === chapterIndex
        ? novel.lastRead.scrollOffset
        : 0;

    if (savedOffset <= 0 || height <= 0) {
      hasRestoredScrollRef.current = true;
      restoredChapterRef.current = chapterIndex;
      return;
    }

    // A newer content-size change superseded the last pending attempt — drop it
    // so we always act on the freshest height instead of piling up scrollTo calls.
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current);
      restoreTimeoutRef.current = null;
    }

    restoreAttemptsRef.current += 1;
    const contentTallEnough =
      height - scrollViewHeightRef.current >= savedOffset;
    const heightSettled = height === lastRestoreHeightRef.current;
    lastRestoreHeightRef.current = height;
    const shouldFinalize =
      contentTallEnough ||
      heightSettled ||
      restoreAttemptsRef.current >= MAX_RESTORE_ATTEMPTS;

    restoreTimeoutRef.current = setTimeout(() => {
      const maxScrollNow = Math.max(
        0,
        contentHeightRef.current - scrollViewHeightRef.current,
      );
      const targetY = Math.min(savedOffset, maxScrollNow);
      scrollRef.current?.scrollTo({ y: targetY, animated: false });
      scrollYRef.current = targetY;
      updateReadingProgress();

      if (shouldFinalize) {
        hasRestoredScrollRef.current = true;
        restoredChapterRef.current = chapterIndex;
        restoreAttemptsRef.current = 0;
        lastRestoreHeightRef.current = 0;
      }
      // Otherwise leave hasRestoredScrollRef false — the next onContentSizeChange,
      // fired as more content finishes laying out, will retry with a taller height.
      restoreTimeoutRef.current = null;
    }, RESTORE_SETTLE_DELAY);
  };

  const handleScrollViewLayout = (event: any) => {
    scrollViewHeightRef.current = event.nativeEvent.layout.height;
    updateReadingProgress();
  };

  // ─── Navigation helpers ──────────────────────────────────────────────
  // Reads novel/chapterIndex via the refs (kept in sync below) rather than
  // closing over the `novel`/`chapterIndex`/`chapter` state directly, so this
  // callback's identity stays stable across renders instead of being
  // recreated every time (which previously caused the listener effect below
  // to unsubscribe/resubscribe on every render).
  const goChapter = useCallback(
    (dir: 1 | -1) => {
      cancelAutoNext();
      const currentNovel = novelRef.current;
      const currentIndex = chapterIndexRef.current;
      const next = currentIndex + dir;
      if (next < 0 || next >= (currentNovel?.chapters.length ?? 0)) {
        Alert.alert(
          "Navigation",
          dir === -1 ? "First chapter reached" : "Last chapter reached",
        );
        return;
      }
      const currentChapter = currentNovel?.chapters[currentIndex];
      if (currentNovel && currentChapter)
        saveReadingProgress(
          currentNovel.id,
          currentIndex,
          currentChapter.title,
          scrollYRef.current,
        );

      // Abort any pending load
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      stopAutoScroll();
      stopTTS();

      // Clear content and show loading immediately
      setChapterContent("");
      setProcessedParagraphs([]);
      setTtsSentences([]);
      setContentLoading(true);

      scrollYRef.current = 0;
      hasRestoredScrollRef.current = false;
      restoreAttemptsRef.current = 0;
      lastRestoreHeightRef.current = 0;
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setChapterIndex(next);
      setReadingProgress(0);
    },
    [cancelAutoNext, saveReadingProgress, stopAutoScroll, stopTTS],
  );

  // speakSentence is memoized once (deps never change) and its closure is
  // frozen to the render it was created on, so it can't safely call
  // goChapter directly (that would always navigate relative to a stale
  // chapterIndex). This ref is reassigned every render so the latest
  // goChapter closure is always reachable from inside that older callback.
  const goChapterRef = useRef(goChapter);
  goChapterRef.current = goChapter;

  // Listen for the auto-next-chapter notification (scheduled a few
  // sentences before end-of-chapter — see "Loading next chapter" in
  // speakSentence below). This is a one-off expo-notifications alert,
  // separate from the persistent TTS playback notification.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.action === "auto_next_chapter") {
          if (chapterIndex + 1 < (novel?.chapters.length || 0)) {
            autoNextResumeRef.current = true;
            goChapter(1);
          }
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [chapterIndex, novel?.chapters.length, goChapter]);

  // Wire the persistent TTS notification's Play/Pause and Stop buttons to
  // the same actions the in-app buttons use. These run from either the
  // foreground or background event handler in lib/TTSMediaSession.ts,
  // which reads whatever was last registered here via getRemoteHandlers().
  useEffect(() => {
    setRemoteHandlers({
      onPlayPause: () => toggleTTS(),
      onStop: () => stopTTS(),
    });

    return () => {
      setRemoteHandlers({});
    };
  }, [toggleTTS, stopTTS]);

  // Update notification as TTS plays
  useEffect(() => {
    if (!novel || !chapter) return;

    if (ttsActive) {
      updateMediaSession({
        novelTitle: novel.title,
        chapterNumber: chapterIndex + 1,
        chapterTitle: chapter.title,
        progressPercent: Math.round(readingProgress),
        isPlaying: true,
      });
    }
  }, [ttsActive, novel, chapter, chapterIndex, readingProgress]);

  const handleChapterSelect = (index: number) => {
    cancelAutoNext();
    if (novel && chapter)
      saveReadingProgress(
        novel.id,
        chapterIndex,
        chapter.title,
        scrollYRef.current,
      );

    // Abort any pending load
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear content and show loading
    setChapterContent("");
    setProcessedParagraphs([]);
    setTtsSentences([]);
    setContentLoading(true);

    scrollYRef.current = 0;
    hasRestoredScrollRef.current = false;
    restoreAttemptsRef.current = 0;
    lastRestoreHeightRef.current = 0;
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current);
      restoreTimeoutRef.current = null;
    }
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setChapterIndex(index);
    setShowTOC(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const continueReading = useCallback(() => {
    const lastRead = novel?.lastRead;
    if (lastRead && lastRead.chapterIndex !== undefined) {
      setChapterIndex(lastRead.chapterIndex);
      setTimeout(() => {
        if (lastRead.scrollOffset > 0) {
          scrollRef.current?.scrollTo({
            y: lastRead.scrollOffset,
            animated: true,
          });
          scrollYRef.current = lastRead.scrollOffset;
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

  // ─── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearMediaSession();
    };
  }, []);

  // ─── Initial loading state ────────────────────────────────────────────
  if (!novel || !chapter || !settingsLoaded) {
    return (
      <View
        style={[styles.center, { backgroundColor: themeColors.background }]}
      >
        <ActivityIndicator size="large" color={themeColors.accent} />
      </View>
    );
  }

  const currentSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
  const ttsAvailable = chapterContent.trim().length >= TTS_MIN_CHARS;
  const currentSentence = ttsIndex >= 0 ? ttsSentences[ttsIndex] : null;

  return (
    <ContentWrapper
      bgImageUri={bgImageUri}
      bgSolidColor={bgSolidColor}
      defaultBgColor={themeColors.background}
    >
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
          <Pressable
            style={styles.navBtn}
            onPress={() => router.back()}
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

        {/* Progress indicator */}
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
                paddingBottom: bottomPad + 100,
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

                  // Derive which sentence within this paragraph is
                  // highlighted as a scalar. This is what lets
                  // React.memo actually bail out: two paragraphs with
                  // highlightedSentIdx=-1 are prop-equal and skip
                  // re-rendering entirely when TTS advances elsewhere.
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
                      onParaLayout={handleParaLayout}
                      onHighlightedSentenceLayout={
                        handleHighlightedSentenceLayout
                      }
                    />
                  );
                })}
              </View>
            )}
          </ScrollView>

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
                // Resume from current index
                if (
                  ttsIndexRef.current >= 0 &&
                  ttsIndexRef.current < ttsSentences.length
                ) {
                  ttsStalledRef.current = false;
                  setTtsStalled(false);
                  ttsStallRetryCountRef.current = 0;
                  ttsActiveRef.current = true;
                  setTtsActive(true);
                  clearWatchdogTimer();
                  speakSentence(ttsSentences, ttsIndexRef.current);
                } else {
                  // If index invalid, just restart
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

          {/* Quick-actions cluster: collapsible group of floating buttons */}
          {ttsAvailable && (
            <View
              style={[
                styles.ttsQuickActionsContainer,
                {
                  backgroundColor: adaptiveColors.card,
                  borderColor: adaptiveColors.border,
                },
              ]}
            >
              {/* Collapse/expand toggle. Down arrow = buttons are showing
                  (default state); tapping it hides the buttons below and
                  flips the icon to an up arrow, which then re-expands
                  them. */}
              <Pressable
                style={styles.ttsQuickActionsToggle}
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

              {quickActionsExpanded && (
                <>
                  {/* Optional: background-playback (notification + battery)
                      setup. Entirely opt-in — nothing here runs on its own,
                      it just opens a guide the user can choose to follow. */}
                  <Pressable
                    style={styles.ttsQuickActionBtn}
                    onPress={() => setShowBackgroundSetup(true)}
                    accessibilityLabel="Background playback setup"
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={16}
                      color={adaptiveColors.text}
                    />
                  </Pressable>

                  {/* Guidebook */}
                  <Pressable
                    style={styles.ttsQuickActionBtn}
                    onPress={() => setShowTTSHelp(true)}
                    accessibilityLabel="TTS guidebook"
                  >
                    <Ionicons
                      name="book-outline"
                      size={16}
                      color={adaptiveColors.text}
                    />
                  </Pressable>

                  {/* TTS play/pause */}
                  <Pressable
                    style={[
                      styles.ttsQuickActionBtn,
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
          )}
        </View>

        {/* TTS status overlay */}
        {ttsActive && currentSentence && (
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
                style={[styles.ttsSentenceText, { color: adaptiveColors.text }]}
                numberOfLines={2}
              >
                {currentSentence.length > 100
                  ? currentSentence.substring(0, 100) + "..."
                  : currentSentence}
              </Text>
            </View>
          </View>
        )}

        {/* TTS Auto Next countdown banner */}
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
                style={[styles.ttsSentenceText, { color: adaptiveColors.text }]}
              >
                Moving to next chapter in 3s — tap to cancel
              </Text>
            </View>
          </Pressable>
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
        </View>

        {/* ========== SETTINGS BOTTOM SHEET ========== */}
        <Modal
          visible={showSettingsSheet}
          animationType="fade"
          transparent
          onRequestClose={() => setShowSettingsSheet(false)}
        >
          <Pressable
            style={styles.overlayDismiss}
            onPress={() => setShowSettingsSheet(false)}
          >
            <Pressable
              style={[
                styles.settingsSheet,
                {
                  backgroundColor: adaptiveColors.surface,
                  borderColor: adaptiveColors.border,
                },
              ]}
              onPress={() => {}}
            >
              <View
                style={[
                  styles.sheetHandle,
                  { backgroundColor: adaptiveColors.border },
                ]}
              />
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: bottomPad + 32 }}
              >
                {/* 1. FONT SIZE - Left label, Button, Value, Button (matches Line Spacing layout) */}
                <View style={styles.rowGroup}>
                  <Text
                    style={[
                      styles.rowGroupLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    FONT SIZE
                  </Text>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.max(0, fontSizeIdx - 1);
                      setFontSizeIdx(newIdx);
                      saveAllSettings(
                        newIdx,
                        lineSpacingIdx,
                        marginPresetIdx,
                        autoScrollSpeedIdx,
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.controlBtnText,
                        { color: adaptiveColors.text, fontSize: 14 },
                      ]}
                    >
                      A
                    </Text>
                  </Pressable>

                  <Text
                    style={[
                      styles.controlValueCenteredSmall,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    {fontSize}PT
                  </Text>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.min(
                        FONT_SIZES.length - 1,
                        fontSizeIdx + 1,
                      );
                      setFontSizeIdx(newIdx);
                      saveAllSettings(
                        newIdx,
                        lineSpacingIdx,
                        marginPresetIdx,
                        autoScrollSpeedIdx,
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.controlBtnText,
                        { color: adaptiveColors.text, fontSize: 18 },
                      ]}
                    >
                      A
                    </Text>
                  </Pressable>
                </View>

                {/* 2. LINE SPACING - Left label, Button, Value, Button */}
                <View style={styles.rowGroup}>
                  <Text
                    style={[
                      styles.rowGroupLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    LINE SPACING
                  </Text>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.max(0, lineSpacingIdx - 1);
                      setLineSpacingIdx(newIdx);
                      saveAllSettings(
                        fontSizeIdx,
                        newIdx,
                        marginPresetIdx,
                        autoScrollSpeedIdx,
                      );
                    }}
                  >
                    <Ionicons
                      name="remove"
                      size={18}
                      color={adaptiveColors.text}
                    />
                  </Pressable>

                  <Text
                    style={[
                      styles.controlValueCenteredSmall,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    {lineSpacing.toFixed(1)}X
                  </Text>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.min(
                        LINE_SPACINGS.length - 1,
                        lineSpacingIdx + 1,
                      );
                      setLineSpacingIdx(newIdx);
                      saveAllSettings(
                        fontSizeIdx,
                        newIdx,
                        marginPresetIdx,
                        autoScrollSpeedIdx,
                      );
                    }}
                  >
                    <Ionicons
                      name="add"
                      size={18}
                      color={adaptiveColors.text}
                    />
                  </Pressable>
                </View>

                {/* 3. AUTO-SCROLL - Left play btn, then Button, Value, Button */}
                <View style={styles.rowGroup}>
                  <Text
                    style={[
                      styles.rowGroupLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    AUTO SCROLL
                  </Text>

                  <Pressable
                    style={[
                      styles.autoScrollPlayBtnSmall,
                      {
                        backgroundColor: autoScrollActive
                          ? adaptiveColors.accent
                          : adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() =>
                      autoScrollActive ? stopAutoScroll() : startAutoScroll()
                    }
                  >
                    <Ionicons
                      name={autoScrollActive ? "pause" : "play"}
                      size={16}
                      color={autoScrollActive ? "#fff" : adaptiveColors.text}
                    />
                  </Pressable>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.max(0, autoScrollSpeedIdx - 1);
                      setAutoScrollSpeedIdx(newIdx);
                      saveAllSettings(
                        fontSizeIdx,
                        lineSpacingIdx,
                        marginPresetIdx,
                        newIdx,
                      );
                    }}
                  >
                    <Ionicons
                      name="remove"
                      size={18}
                      color={adaptiveColors.text}
                    />
                  </Pressable>

                  <Text
                    style={[
                      styles.controlValueCenteredSmall,
                      { color: adaptiveColors.text },
                    ]}
                  >
                    {currentSpeed.toFixed(1)}X
                  </Text>

                  <Pressable
                    style={[
                      styles.controlBtnSmall,
                      {
                        backgroundColor: adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      const newIdx = Math.min(
                        AUTO_SCROLL_SPEEDS.length - 1,
                        autoScrollSpeedIdx + 1,
                      );
                      setAutoScrollSpeedIdx(newIdx);
                      saveAllSettings(
                        fontSizeIdx,
                        lineSpacingIdx,
                        marginPresetIdx,
                        newIdx,
                      );
                    }}
                  >
                    <Ionicons
                      name="add"
                      size={18}
                      color={adaptiveColors.text}
                    />
                  </Pressable>
                </View>

                {/* TTS AUTO NEXT — only visible while TTS is speaking */}
                {ttsActive && (
                  <View style={styles.rowGroup}>
                    <Text
                      style={[
                        styles.rowGroupLabel,
                        { color: adaptiveColors.textSecondary },
                      ]}
                    >
                      TTS AUTO NEXT
                    </Text>
                    <Pressable
                      style={[
                        styles.autoNextToggleBtn,
                        {
                          backgroundColor: ttsAutoNext
                            ? adaptiveColors.accent
                            : adaptiveColors.card,
                          borderColor: adaptiveColors.border,
                        },
                      ]}
                      onPress={toggleTtsAutoNext}
                    >
                      <Ionicons
                        name={
                          ttsAutoNext ? "checkmark-circle" : "ellipse-outline"
                        }
                        size={15}
                        color={ttsAutoNext ? "#fff" : adaptiveColors.text}
                      />
                      <Text
                        style={[
                          styles.autoNextToggleText,
                          {
                            color: ttsAutoNext ? "#fff" : adaptiveColors.text,
                          },
                        ]}
                      >
                        {ttsAutoNext ? "On" : "Off"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* 4. MARGINS */}
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: adaptiveColors.textSecondary, marginTop: 4 },
                  ]}
                >
                  MARGINS
                </Text>
                <View style={styles.marginRow}>
                  {MARGIN_PRESETS.map((label, idx) => (
                    <Pressable
                      key={idx}
                      style={[
                        styles.marginPresetBtn,
                        {
                          backgroundColor:
                            marginPresetIdx === idx
                              ? adaptiveColors.accent
                              : adaptiveColors.card,
                          borderColor:
                            marginPresetIdx === idx
                              ? adaptiveColors.accent
                              : adaptiveColors.border,
                        },
                      ]}
                      onPress={() => {
                        setMarginPresetIdx(idx);
                        saveAllSettings(
                          fontSizeIdx,
                          lineSpacingIdx,
                          idx,
                          autoScrollSpeedIdx,
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.marginPresetText,
                          {
                            color:
                              marginPresetIdx === idx
                                ? "#fff"
                                : adaptiveColors.text,
                          },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* 5. BACKGROUND - Now at the bottom */}
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: adaptiveColors.textSecondary, marginTop: 12 },
                  ]}
                >
                  BACKGROUND
                </Text>
                <View style={styles.bgRow}>
                  <Pressable
                    style={[
                      styles.bgCurrentBtn,
                      {
                        borderColor: adaptiveColors.border,
                        backgroundColor: adaptiveColors.card,
                      },
                    ]}
                    onPress={pickCustomImage}
                  >
                    {bgCustomUri ? (
                      <Image
                        source={{ uri: bgCustomUri }}
                        style={styles.bgCurrentImage}
                        resizeMode="cover"
                      />
                    ) : bgSolidColor && bgSolidColor !== "transparent" ? (
                      <View
                        style={[
                          styles.bgCurrentImage,
                          { backgroundColor: bgSolidColor },
                        ]}
                      />
                    ) : (
                      <View style={styles.bgCurrentEmpty}>
                        <Ionicons
                          name="image-outline"
                          size={22}
                          color={adaptiveColors.textSecondary}
                        />
                        <Text
                          style={[
                            styles.bgCurrentLabel,
                            { color: adaptiveColors.textSecondary },
                          ]}
                        >
                          Custom
                        </Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.bgBtnLabel,
                        { color: adaptiveColors.textSecondary },
                      ]}
                    >
                      Current Image
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.bgPresetsBtn,
                      {
                        borderColor: adaptiveColors.border,
                        backgroundColor: adaptiveColors.card,
                      },
                    ]}
                    onPress={() => setShowBgModal(true)}
                  >
                    <View style={styles.bgPresetsGrid}>
                      {BG_PRESETS.slice(1, 5).map((p) => (
                        <View
                          key={p.id}
                          style={[
                            styles.bgPresetsGridCell,
                            { backgroundColor: p.color },
                          ]}
                        />
                      ))}
                    </View>
                    <Text
                      style={[
                        styles.bgBtnLabel,
                        { color: adaptiveColors.textSecondary },
                      ]}
                    >
                      Presets
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Background Presets Modal (nested) */}
        <Modal
          visible={showBgModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowBgModal(false)}
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
                  Background Presets
                </Text>
                <Pressable
                  onPress={() => setShowBgModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={adaptiveColors.text}
                  />
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
                        {
                          borderColor: isActive
                            ? adaptiveColors.accent
                            : adaptiveColors.border,
                          borderWidth: isActive ? 2 : 1,
                        },
                      ]}
                      onPress={() => selectPreset(preset)}
                    >
                      <View
                        style={[
                          styles.bgPresetSwatch,
                          { backgroundColor: preset.color, overflow: "hidden" },
                        ]}
                      >
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
                      <Text
                        style={[
                          styles.bgPresetLabel,
                          {
                            color: isActive
                              ? adaptiveColors.accent
                              : adaptiveColors.text,
                          },
                        ]}
                      >
                        {preset.label}
                      </Text>
                      {isActive && (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={adaptiveColors.accent}
                        />
                      )}
                    </Pressable>
                  );
                })}
                <Pressable
                  style={[
                    styles.bgPresetItem,
                    {
                      borderColor: bgCustomUri
                        ? adaptiveColors.accent
                        : adaptiveColors.border,
                      borderWidth: bgCustomUri ? 2 : 1,
                    },
                  ]}
                  onPress={pickCustomImage}
                >
                  <View
                    style={[
                      styles.bgPresetSwatch,
                      {
                        backgroundColor: adaptiveColors.card,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                  >
                    {bgCustomUri ? (
                      <Image
                        source={{ uri: bgCustomUri }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons
                        name="add"
                        size={22}
                        color={adaptiveColors.textSecondary}
                      />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.bgPresetLabel,
                      {
                        color: bgCustomUri
                          ? adaptiveColors.accent
                          : adaptiveColors.text,
                      },
                    ]}
                  >
                    {bgCustomUri
                      ? "Custom (tap to change)"
                      : "Pick from Gallery"}
                  </Text>
                  {bgCustomUri && (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={adaptiveColors.accent}
                    />
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* TTS Help Modal */}
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

        {/* Background Playback Setup Modal — entirely optional, opened only
            via the shield button in the quick-actions cluster. Nothing
            here runs automatically; every step is a user-initiated tap. */}
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
                Optional. Some phones (Xiaomi/MIUI, Oppo, Vivo, Huawei
                especially) stop narration a few seconds after you lock the
                screen or leave the app to save battery. These three
                settings fix that — we can&apos;t change them for you, so tap
                each one you&apos;d like to open.
              </Text>

              {/* Step 1: Notification permission */}
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
                    Required so Android knows narration is actively playing.
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

              {/* Step 2: Battery optimization exemption */}
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
                    Tells Android not to restrict NovelDR&apos;s background
                    activity while narrating.
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

              {/* Step 3: OEM autostart / power manager, only shown when the
                  device actually exposes one (notifee returns no activity
                  on stock Android) */}
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
                      Your phone&apos;s manufacturer (not Android itself) applies
                      this extra restriction on some devices.
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

        {/* TTS Settings Modal */}
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
                    onPress={async () => {
                      try {
                        const voices = await Speech.getAvailableVoicesAsync();
                        const english = voices.filter((v) =>
                          v.language?.toLowerCase().startsWith("en"),
                        );
                        setTtsVoices(english.length > 0 ? english : voices);
                      } catch (e) {
                        console.warn(e);
                      }
                    }}
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
                    {[0.5, 1.0, 1.5, 2.0, 2.5].map((rate) => (
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
                          ttsRateRef.current = rate;
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
                            ttsVoiceIdRef.current = voice.identifier;
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

        {/* TOC Modal */}
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
                {novel.chapters.map((ch, idx) => (
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

        {/* Search Modal */}
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

        {/* Rapid-tap warning — workaround for the scheduler/Skia crashes.
            Tapping this rapidly won't re-trip it further; dismissing resets
            the tap-timestamp window so normal use resumes immediately. */}
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
  navBtn: {
    width: 44,
    height: 44,
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
  ttsQuickActionsContainer: {
    position: "absolute",
    bottom: 18,
    right: 18,
    width: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
    elevation: 4,
  },
  ttsQuickActionsToggle: {
    width: 30,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  ttsQuickActionBtn: {
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
  ttsStalledBanner: {
    position: "absolute",
    bottom: 65,
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
    marginBottom: 20,
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
  // Sheet styles
  overlayDismiss: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  settingsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: "70%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  // NEW LAYOUT STYLES
  controlRowCentered: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    marginBottom: 16,
  },
  controlBtnPill: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
  },
  controlValueCentered: {
    fontSize: 16,
    fontWeight: "600",
    minWidth: 50,
    textAlign: "center",
  },
  rowGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  rowGroupLabel: { fontSize: 13, fontWeight: "600", flex: 1 },
  controlValueCenteredSmall: {
    fontSize: 15,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "center",
  },
  controlBtnSmall: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
  },
  autoScrollPlayBtnSmall: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 8,
  },
  autoNextToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  autoNextToggleText: { fontSize: 13, fontWeight: "600" },

  // OLD BACKGROUND LAYOUT STYLES
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  controlBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
  controlBtnText: { fontWeight: "600" },
  controlValue: { fontSize: 15, width: 50, textAlign: "center" },
  marginRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  marginPresetBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  marginPresetText: { fontSize: 13, fontWeight: "500" },
  bgRow: { flexDirection: "row", gap: 12, marginBottom: 8 },
  bgCurrentBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  bgCurrentImage: { width: "100%", height: 60 },
  bgCurrentEmpty: {
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  bgCurrentLabel: { fontSize: 10 },
  bgBtnLabel: { fontSize: 11, textAlign: "center", paddingVertical: 6 },
  bgPresetsBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  bgPresetsGrid: { flexDirection: "row", flexWrap: "wrap", height: 60 },
  bgPresetsGridCell: { width: "50%", height: "50%" },

  autoScrollRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
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
  speedControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  },
  controlValueSmall: { fontSize: 14, width: 40, textAlign: "center" },
  bgPresetsList: { paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  bgPresetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    padding: 10,
  },
  bgPresetSwatch: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: "hidden",
  },
  bgPresetLabel: { fontSize: 14, fontWeight: "500", flex: 1 },
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