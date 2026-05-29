import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

const FONT_SIZES = [14, 15, 16, 17, 18, 19, 20, 22];
const LINE_SPACINGS = [1.2, 1.3, 1.5, 1.8, 2.0, 2.5];
const AUTO_SCROLL_SPEEDS = [0.5, 1, 1.5, 1.8, 2, 2.5];

const READER_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/reader_settings.json`;
const TTS_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/tts_simple_settings.json`;
const TTS_MIN_CHARS = 500;

function splitIntoSentences(text: string): string[] {
  let cleanText = text.replace(/[""'']/g, '"');
  cleanText = cleanText.replace(/→|->|=>|→/g, ' to ');
  cleanText = cleanText.replace(/←|<-|<=/g, ' from ');
  cleanText = cleanText.replace(/↔|<->/g, ' between ');
  const raw = cleanText.match(/[^.!?…\n]+[.!?…]*|[^\n]+/g) ?? [];
  const sentences: string[] = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed.length <= 1) continue;
    if (trimmed.includes('\n') || trimmed.match(/\s{2,}/)) {
      const segments = trimmed.split(/\n+|\s{2,}/).filter(s => s.trim().length > 0);
      segments.forEach(segment => {
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

export default function ReaderScreen() {
  const { id, chapterIndex: indexParam } = useLocalSearchParams<{ id: string; chapterIndex: string }>();
  const { getNovel, saveReadingProgress, loadChapterContent } = useLibrary();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // UI state
  const [fontSizeIdx, setFontSizeIdx] = useState(1);
  const [lineSpacingIdx, setLineSpacingIdx] = useState(1);
  const [autoScrollSpeedIdx, setAutoScrollSpeedIdx] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(parseInt(indexParam) || 0);
  const scrollRef = useRef<ScrollView>(null);

  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const hasRestoredScrollRef = useRef(false);
  const restoredChapterRef = useRef<number>(-1);
  const forceTopRef = useRef(false);

  const [chapterContent, setChapterContent] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);

  // TTS states
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

  // Load general settings
  useEffect(() => {
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(READER_SETTINGS_FILE);
        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(READER_SETTINGS_FILE);
          const settings = JSON.parse(content);
          if (settings.fontSizeIdx !== undefined) setFontSizeIdx(settings.fontSizeIdx);
          if (settings.lineSpacingIdx !== undefined) setLineSpacingIdx(settings.lineSpacingIdx);
          if (settings.autoScrollSpeedIdx !== undefined) setAutoScrollSpeedIdx(settings.autoScrollSpeedIdx);
        }
      } catch (error) {
        console.error('Failed to load reader settings:', error);
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  const saveAllSettings = async (font: number, line: number, scroll: number) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        READER_SETTINGS_FILE,
        JSON.stringify({ fontSizeIdx: font, lineSpacingIdx: line, autoScrollSpeedIdx: scroll })
      );
    } catch (error) { console.error('Failed to save settings:', error); }
  };

  // Load TTS settings
  useEffect(() => {
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(TTS_SETTINGS_FILE);
        if (fileInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(TTS_SETTINGS_FILE);
          const s = JSON.parse(raw);
          if (s.voiceId !== undefined) { setTtsVoiceId(s.voiceId); ttsVoiceIdRef.current = s.voiceId; }
          if (s.rate !== undefined) { setTtsRate(s.rate); ttsRateRef.current = s.rate; }
        }
      } catch (e) { console.warn('[TTS] Failed to load TTS settings:', e); }
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const english = voices.filter(v => v.language?.toLowerCase().startsWith('en'));
        setTtsVoices(english.length > 0 ? english : voices);
      } catch (e) { console.warn('[TTS] Could not load voices:', e); }
    })();
  }, []);

  const saveTtsSettings = async (voiceId: string | undefined, rate: number) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(TTS_SETTINGS_FILE, JSON.stringify({ voiceId, rate }));
    } catch (e) { console.warn('[TTS] Failed to save settings:', e); }
  };

  // Load chapter content
  const loadContent = async () => {
    if (novel && chapter) {
      setContentLoading(true);
      try {
        let content = chapter.content || "";
        if (!content && loadChapterContent) {
          const fileChapter = await loadChapterContent(novel.id, chapterIndex);
          content = fileChapter?.content || "";
        }
        setChapterContent(content);
        setTtsSentences(splitIntoSentences(content));
      } catch (error) {
        setChapterContent("Error loading chapter content. Please try again.");
      } finally {
        setContentLoading(false);
      }
    }
  };

  useEffect(() => { loadContent(); }, [chapterIndex, novel?.id]);

  const novelRef = useRef(novel);
  const chapterIndexRef = useRef(chapterIndex);
  const chapterRef = useRef(chapter);

  useEffect(() => { novelRef.current = novel; }, [novel]);
  useEffect(() => { chapterIndexRef.current = chapterIndex; }, [chapterIndex]);
  useEffect(() => { chapterRef.current = chapter; }, [chapter]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      Speech.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Save progress on unmount (when user closes the reader)
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
    try { Speech.stop(); } catch {}
  }, []);

  useEffect(() => { stopTTS(); }, [chapterIndex]);

  const speakSentence = useCallback((sentences: string[], index: number) => {
    if (!isMountedRef.current) return;
    if (index >= sentences.length || !ttsActiveRef.current) { stopTTS(); return; }
    ttsIndexRef.current = index;
    setTtsIndex(index);
    try {
      try { Speech.stop(); } catch {}
      Speech.speak(sentences[index], {
        language: 'en',
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
          console.warn('[TTS] Error speaking sentence:', err);
          if (!isMountedRef.current) return;
          if (!ttsActiveRef.current) return;
          ttsErrorCountRef.current += 1;
          if (ttsErrorCountRef.current > 3) { stopTTS(); return; }
          speakSentence(sentences, index + 1);
        }
      });
    } catch (err) {
      console.error('[TTS] Unexpected error in speakSentence:', err);
      stopTTS();
    }
  }, [stopTTS]);

  const toggleTTS = useCallback(() => {
    if (ttsActiveRef.current) { stopTTS(); return; }
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
          language: 'en',
          pitch: 1.0,
          rate: ttsRateRef.current,
          voice: ttsVoiceIdRef.current,
        });
      } catch (err) { console.warn('[TTS] Preview error:', err); }
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
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setAutoScrollActive(false);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const speed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
    intervalRef.current = setInterval(() => {
      if (!scrollRef.current) return;
      const currentY = scrollYRef.current;
      const maxY = Math.max(0, contentHeightRef.current - scrollViewHeightRef.current);
      if (currentY >= maxY) { stopAutoScroll(); return; }
      const newY = Math.min(maxY, currentY + ((30 * speed) / 20));
      scrollRef.current.scrollTo({ y: newY, animated: false });
      scrollYRef.current = newY;
    }, 50);
    setAutoScrollActive(true);
  }, [autoScrollSpeedIdx, stopAutoScroll]);

  const handleScroll = (event: any) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    updateReadingProgress();
  };

  const handleScrollBeginDrag = () => { if (autoScrollActive) stopAutoScroll(); };

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
    forceTopRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChapterIndex(next);
    setReadingProgress(0);
  };

  const handleChapterSelect = (index: number) => {
    if (novel && chapter) saveReadingProgress(novel.id, chapterIndex, chapter.title, scrollYRef.current);
    scrollYRef.current = 0;
    hasRestoredScrollRef.current = false;
    forceTopRef.current = true;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setChapterIndex(index);
    setShowTOC(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!novel || !chapter || !settingsLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const fontSize = FONT_SIZES[fontSizeIdx];
  const lineSpacing = LINE_SPACINGS[lineSpacingIdx];
  const currentSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
  const ttsAvailable = chapterContent.trim().length >= TTS_MIN_CHARS;
  const currentSentence = ttsIndex >= 0 ? ttsSentences[ttsIndex] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: topPad + 4, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Pressable style={styles.navBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.chapterTitle, { color: colors.text }]} numberOfLines={1}>{chapter.title}</Text>
        <Pressable style={styles.navBtn} onPress={() => setShowControls(v => !v)}>
          <Ionicons name="settings-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Controls panel */}
      {showControls && (
        <View style={[styles.controls, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.controlRow}>
            <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>Font Size</Text>
            <View style={styles.controlBtns}>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.max(0, fontSizeIdx - 1); setFontSizeIdx(newIdx); saveAllSettings(newIdx, lineSpacingIdx, autoScrollSpeedIdx); }}>
                <Text style={[styles.controlBtnText, { color: colors.text, fontSize: 12 }]}>A</Text>
              </Pressable>
              <Text style={[styles.controlValue, { color: colors.text }]}>{fontSize}pt</Text>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.min(FONT_SIZES.length - 1, fontSizeIdx + 1); setFontSizeIdx(newIdx); saveAllSettings(newIdx, lineSpacingIdx, autoScrollSpeedIdx); }}>
                <Text style={[styles.controlBtnText, { color: colors.text, fontSize: 18 }]}>A</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.controlRow}>
            <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>Line Spacing</Text>
            <View style={styles.controlBtns}>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.max(0, lineSpacingIdx - 1); setLineSpacingIdx(newIdx); saveAllSettings(fontSizeIdx, newIdx, autoScrollSpeedIdx); }}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </Pressable>
              <Text style={[styles.controlValue, { color: colors.text }]}>{lineSpacing.toFixed(1)}x</Text>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.min(LINE_SPACINGS.length - 1, lineSpacingIdx + 1); setLineSpacingIdx(newIdx); saveAllSettings(fontSizeIdx, newIdx, autoScrollSpeedIdx); }}>
                <Ionicons name="add" size={16} color={colors.text} />
              </Pressable>
            </View>
          </View>
          <View style={styles.controlRow}>
            <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>AutoScroll</Text>
            <View style={styles.controlBtns}>
              <Pressable style={[styles.controlBtn, { backgroundColor: autoScrollActive ? colors.accent : colors.surface, borderColor: colors.border }]} onPress={() => autoScrollActive ? stopAutoScroll() : startAutoScroll()}>
                <Ionicons name={autoScrollActive ? "pause" : "play"} size={16} color={autoScrollActive ? "#fff" : colors.text} />
              </Pressable>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.max(0, autoScrollSpeedIdx - 1); setAutoScrollSpeedIdx(newIdx); saveAllSettings(fontSizeIdx, lineSpacingIdx, newIdx); }}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </Pressable>
              <Text style={[styles.controlValue, { color: colors.text }]}>{currentSpeed.toFixed(1)}x</Text>
              <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => { const newIdx = Math.min(AUTO_SCROLL_SPEEDS.length - 1, autoScrollSpeedIdx + 1); setAutoScrollSpeedIdx(newIdx); saveAllSettings(fontSizeIdx, lineSpacingIdx, newIdx); }}>
                <Ionicons name="add" size={16} color={colors.text} />
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Scrollable content wrapper */}
      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={[styles.textContainer, { paddingBottom: bottomPad + 100 }]}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleScrollViewLayout}
          scrollEventThrottle={16}
        >
          <Text style={[styles.chapterHeader, { color: colors.accent }]}>{chapter.title}</Text>
          {contentLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <Text style={[styles.content, { color: colors.text, fontSize, lineHeight: fontSize * lineSpacing }]}>
              {chapterContent.split('\n').map((line, lineIdx) => {
                const parts: any[] = [];
                let lastIndex = 0;
                const normalizedLine = line
                  .replace(/→|->|=>|→/g, ' to ')
                  .replace(/←|<-|<=/g, ' from ')
                  .replace(/↔|<->/g, ' between ');
                ttsSentences.forEach((sentence, sentIdx) => {
                  const cleanSentence = sentence.replace(/[""'']/g, '"');
                  const index = normalizedLine.indexOf(cleanSentence);
                  if (index !== -1) {
                    if (index > lastIndex) {
                      parts.push({ text: line.substring(lastIndex, index), isCurrent: false });
                    }
                    parts.push({ text: line.substring(index, index + cleanSentence.length), isCurrent: sentIdx === ttsIndex });
                    lastIndex = index + cleanSentence.length;
                  }
                });
                if (lastIndex < line.length) {
                  parts.push({ text: line.substring(lastIndex), isCurrent: false });
                }
                if (parts.length === 0) {
                  parts.push({ text: line, isCurrent: false });
                }
                return (
                  <Text key={lineIdx}>
                    {parts.map((part, partIdx) => (
                      <Text
                        key={partIdx}
                        style={{
                          backgroundColor: part.isCurrent ? `${colors.accent}30` : 'transparent',
                          color: part.isCurrent ? colors.accent : colors.text,
                        }}
                      >
                        {part.text}
                      </Text>
                    ))}
                    {'\n'}
                  </Text>
                );
              })}
            </Text>
          )}
        </ScrollView>

        {/* TTS Help Button */}
        {ttsAvailable && (
          <Pressable
            style={[styles.ttsHelpBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowTTSHelp(true)}
          >
            <Ionicons name="book-outline" size={20} color={colors.text} />
          </Pressable>
        )}

        {/* TTS Floating Button */}
        {ttsAvailable && (
          <Pressable
            style={[styles.ttsFloatingBtn, { backgroundColor: colors.accent }]}
            onPress={toggleTTS}
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setShowTTSSettings(true); }}
            delayLongPress={400}
          >
            <Ionicons name={ttsActive ? "pause" : "volume-high"} size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* TTS status overlay */}
      {ttsActive && (
        <View style={[styles.ttsSentenceBox, { backgroundColor: colors.accent + '12', borderColor: colors.accent + '40' }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.accent} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.ttsSentenceLabel, { color: colors.accent }]}>now reading</Text>
            <Text style={[styles.ttsSentenceText, { color: colors.text }]} numberOfLines={2} ellipsizeMode="tail">
              {currentSentence ?? "Starting…"}
            </Text>
          </View>
        </View>
      )}

      {/* Progress bar */}
      <View style={[styles.progressBarContainer, { backgroundColor: colors.border }]}>
        <View style={[styles.progressBar, { backgroundColor: colors.accent, width: `${readingProgress}%` }]} />
      </View>

      {/* Bottom navigation */}
      <View style={[styles.bottomNav, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: bottomPad + 8 }]}>
        <Pressable style={[styles.navChBtn, { backgroundColor: chapterIndex === 0 ? colors.border : colors.card, borderColor: colors.border }]} onPress={() => goChapter(-1)} disabled={chapterIndex === 0}>
          <Ionicons name="chevron-back" size={18} color={chapterIndex === 0 ? colors.textMuted : colors.text} />
          <Text style={[styles.navChText, { color: chapterIndex === 0 ? colors.textMuted : colors.text }]}>Prev</Text>
        </Pressable>
        <Pressable style={[styles.tocButton, { borderColor: colors.border }]} onPress={() => setShowTOC(true)}>
          <Text style={[styles.tocButtonText, { color: colors.text }]}>{chapterIndex + 1} / {novel.chapters.length}</Text>
        </Pressable>
        <Pressable style={[styles.navChBtn, { backgroundColor: chapterIndex === novel.chapters.length - 1 ? colors.border : colors.accent, borderColor: chapterIndex === novel.chapters.length - 1 ? colors.border : colors.accent }]} onPress={() => goChapter(1)} disabled={chapterIndex === novel.chapters.length - 1}>
          <Text style={[styles.navChText, { color: chapterIndex === novel.chapters.length - 1 ? colors.textMuted : "#fff" }]}>Next</Text>
          <Ionicons name="chevron-forward" size={18} color={chapterIndex === novel.chapters.length - 1 ? colors.textMuted : "#fff"} />
        </Pressable>
      </View>

      {/* TOC Modal */}
      <Modal visible={showTOC} animationType="slide" transparent onRequestClose={() => setShowTOC(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Table of Contents</Text>
              <Pressable onPress={() => setShowTOC(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScrollView}>
              {novel.chapters.map((ch, idx) => (
                <Pressable
                  key={idx}
                  style={[styles.tocItem, idx === chapterIndex && [styles.tocItemActive, { backgroundColor: colors.accent + '20' }]]}
                  onPress={() => handleChapterSelect(idx)}
                >
                  <View style={styles.tocItemContent}>
                    <Text style={[styles.tocChapterNum, { color: idx === chapterIndex ? colors.accent : colors.textSecondary }]}>
                      Chapter {idx + 1}
                    </Text>
                    <Text style={[styles.tocChapterTitle, { color: idx === chapterIndex ? colors.accent : colors.text }]}>
                      {ch.title}
                    </Text>
                  </View>
                  {idx === chapterIndex && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* TTS Help Modal */}
      <Modal visible={showTTSHelp} animationType="fade" transparent onRequestClose={() => setShowTTSHelp(false)}>
        <Pressable style={styles.ttsModalOverlay} onPress={() => setShowTTSHelp(false)}>
          <Pressable style={[styles.ttsHelpModal, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={[styles.ttsModalHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.ttsModalTitle, { color: colors.text }]}>How to Use Text-to-Speech</Text>
            {[
              { icon: "volume-high",         title: "Start / Pause Reading",  desc: "Tap the speaker button to start TTS. Tap again to pause." },
              { icon: "settings-outline",    title: "Open TTS Settings",       desc: "Long-press the speaker button (hold ~0.4s) to open the settings panel." },
              { icon: "refresh",             title: "Load More Voices",        desc: "Inside settings, if no voices appear, tap Reload Engines to fetch available voices." },
              { icon: "musical-note",        title: "Change Voice & Speed",    desc: "Select a voice chip and a speed (0.5x–2.5x), then tap Preview Voice to test it." },
              { icon: "close-circle-outline",title: "Close Settings",          desc: "Tap Save Values or tap anywhere outside the panel to dismiss settings." },
            ].map(({ icon, title, desc }) => (
              <View key={title} style={styles.ttsHelpItem}>
                <View style={[styles.ttsHelpIconWrap, { backgroundColor: colors.accent + '20' }]}>
                  <Ionicons name={icon as any} size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ttsHelpTitle, { color: colors.text }]}>{title}</Text>
                  <Text style={[styles.ttsHelpDesc, { color: colors.textSecondary }]}>{desc}</Text>
                </View>
              </View>
            ))}
            {/*<Pressable style={[styles.ttsSaveBtn, { backgroundColor: colors.accent, marginTop: 20 }]} onPress={() => setShowTTSHelp(false)}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Got it!</Text>
            </Pressable>*/}
          </Pressable>
        </Pressable>
      </Modal>

      {/* TTS Settings Modal */}
      <Modal visible={showTTSSettings} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setShowTTSSettings(false)}>
        <View style={styles.ttsModalOverlay}>
          <Pressable style={styles.ttsModalDismiss} onPress={() => setShowTTSSettings(false)} />
          <View style={[styles.ttsModalSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.ttsModalHandle, { backgroundColor: colors.border }]} />
            {ttsVoices.length === 0 ? (
              <>
                <Text style={[styles.ttsModalTitle, { color: colors.text, textAlign: 'center' }]}>No Engines Found</Text>
                <Pressable style={[styles.ttsReloadBtn, { backgroundColor: colors.accent }]} onPress={async () => {
                  try {
                    const voices = await Speech.getAvailableVoicesAsync();
                    const english = voices.filter(v => v.language?.toLowerCase().startsWith('en'));
                    setTtsVoices(english.length > 0 ? english : voices);
                  } catch (e) { console.warn(e); }
                }}>
                  <Ionicons name="refresh" size={20} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 8 }}>Reload Engines</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.ttsModalSubtitle, { color: colors.text }]}>Voice Speed</Text>
                <View style={styles.speedButtonsRow}>
                  {[0.5, 1.0, 1.5, 2.0, 2.5].map(rate => (
                    <Pressable
                      key={rate}
                      style={[styles.speedButton, { backgroundColor: Math.abs(ttsRate - rate) < 0.01 ? colors.accent : colors.card, borderColor: colors.border }]}
                      onPress={() => { setTtsRate(rate); ttsRateRef.current = rate; saveTtsSettings(ttsVoiceId, rate); }}
                    >
                      <Text style={[styles.speedButtonText, { color: Math.abs(ttsRate - rate) < 0.01 ? '#fff' : colors.text }]}>{rate}x</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.ttsModalSubtitle, { color: colors.text, marginTop: 16 }]}>Voices</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                  {ttsVoices.map((voice) => {
                    const isSelected = ttsVoiceId === voice.identifier;
                    return (
                      <Pressable
                        key={voice.identifier}
                        style={[styles.ttsVoiceChip, { backgroundColor: isSelected ? colors.accent : colors.card, borderColor: isSelected ? colors.accent : colors.border }]}
                        onPress={() => { setTtsVoiceId(voice.identifier); ttsVoiceIdRef.current = voice.identifier; saveTtsSettings(voice.identifier, ttsRate); }}
                      >
                        <Text style={[styles.ttsVoiceChipText, { color: isSelected ? '#fff' : colors.text }]}>{voice.name ?? voice.identifier}</Text>
                        <Text style={[styles.ttsVoiceChipLang, { color: isSelected ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>{voice.language}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.ttsButtonsRow}>
                  <Pressable style={[styles.ttsPreviewBtn, { borderColor: colors.accent }]} onPress={previewTts}>
                    <Ionicons name="play-circle-outline" size={20} color={colors.accent} />
                    <Text style={{ color: colors.accent, marginLeft: 6 }}>Preview Voice</Text>
                  </Pressable>
                  <Pressable style={[styles.ttsSaveBtn, { backgroundColor: colors.accent }]} onPress={() => setShowTTSSettings(false)}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Save Values</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chapterTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1, textAlign: "center" },
  progressBarContainer: { height: 3, width: '100%', overflow: 'hidden' },
  progressBar: { height: '100%', width: '0%' },
  controls: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  controlLabel: { fontFamily: "Inter_500Medium", fontSize: 13, width: 80 },
  controlBtns: { flexDirection: "row", alignItems: "center", gap: 12 },
  controlBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1 },
  controlBtnText: { fontFamily: "Inter_700Bold" },
  controlValue: { fontFamily: "Inter_500Medium", fontSize: 13, width: 40, textAlign: "center" },
  scrollArea: { flex: 1 },
  textContainer: { paddingHorizontal: 22, paddingTop: 20 },
  chapterHeader: { fontFamily: "Inter_700Bold", fontSize: 18, marginBottom: 20, lineHeight: 26 },
  content: { fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  ttsHelpBtn: { position: 'absolute', bottom: 74, right: 18, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1, elevation: 3 },
  ttsFloatingBtn: { position: 'absolute', bottom: 20, right: 18, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  ttsHelpModal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12, marginBottom: 11 },
  ttsHelpItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  ttsHelpIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  ttsHelpTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 3 },
  ttsHelpDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  ttsSentenceBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 14, marginBottom: 20, borderRadius: 10, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 8 },
  ttsSentenceLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  ttsSentenceText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  bottomNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  navChBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  navChText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  tocButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, minWidth: 70, alignItems: "center" },
  tocButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', minHeight: '50%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0' },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  modalCloseBtn: { padding: 4 },
  modalScrollView: { paddingHorizontal: 20, paddingVertical: 12 },
  tocItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0' },
  tocItemActive: { borderRadius: 8 },
  tocItemContent: { flex: 1 },
  tocChapterNum: { fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 4 },
  tocChapterTitle: { fontFamily: "Inter_500Medium", fontSize: 14 },
  ttsModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  ttsModalDismiss: { flex: 1 },
  ttsModalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12, marginBottom: 11 },
  ttsModalHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  ttsModalTitle: { fontFamily: "Inter_700Bold", fontSize: 17, marginBottom: 20 },
  ttsModalSubtitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 12 },
  speedButtonsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  speedButton: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  speedButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  ttsButtonsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 24 },
  ttsPreviewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  ttsSaveBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10 },
  ttsReloadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginHorizontal: 20, borderRadius: 10 },
  ttsVoiceChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center', minWidth: 80 },
  ttsVoiceChipText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  ttsVoiceChipLang: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
});
