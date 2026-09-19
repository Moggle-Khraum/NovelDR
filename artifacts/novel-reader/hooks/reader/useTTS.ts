// hooks/reader/useTTS.ts
import { useState, useEffect, useRef, useCallback } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import { AccessibilityInfo, AppState, InteractionManager } from "react-native";
import * as Notifications from "expo-notifications";
import * as FileSystem from "expo-file-system";
import { TTS_SETTINGS_FILE } from "@/constants/readerSettings";
import { TTS_PAUSE_MARKER } from "@/hooks/reader/useChapterPersistence";
import {
  updateMediaSession,
  clearMediaSession,
  setupMediaSession,
  setRemoteHandlers,
} from "@/lib/TTSMediaSession";

// How long to hold silence at each bracket, per TTS_PAUSE_MARKER in the
// sentence text (see normalizeForSpeech in useChapterPersistence.ts).
const TTS_PAUSE_MS = 1000;

type UseTTSProps = {
  ttsSentences: string[];
  novel: any;
  chapterIndex: number;
  goToNextChapter: () => void;
  // Returns the sentence index to start a *fresh* TTS session from, based
  // on wherever the reader currently is on screen (not tied to TTS's own
  // last-spoken position, which stopTTS() always resets to -1). Optional
  // so callers that don't track scroll/paragraph position can omit it -
  // playback just starts at 0, same as before.
  getStartIndex?: () => number;
};

export function useTTS({
  ttsSentences,
  novel,
  chapterIndex,
  goToNextChapter,
  getStartIndex,
}: UseTTSProps) {
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsIndex, setTtsIndex] = useState(-1);
  const [ttsStalled, setTtsStalled] = useState(false);
  const [autoNextCountdownActive, setAutoNextCountdownActive] = useState(false);
  const [ttsAutoNext, setTtsAutoNext] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsVoiceId, setTtsVoiceId] = useState<string | undefined>(undefined);
  const [ttsVoices, setTtsVoices] = useState<Speech.Voice[]>([]);
  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [showTTSHelp, setShowTTSHelp] = useState(false);

  const ttsActiveRef = useRef(false);
  const ttsIndexRef = useRef(-1);
  const ttsStalledRef = useRef(false);
  const ttsAutoNextRef = useRef(false);
  const ttsRateRef = useRef(1.0);
  const ttsVoiceIdRef = useRef<string | undefined>(undefined);
  const ttsErrorCountRef = useRef(0);
  const ttsStallRetryCountRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    ttsActiveRef.current = ttsActive;
  }, [ttsActive]);
  useEffect(() => {
    ttsIndexRef.current = ttsIndex;
  }, [ttsIndex]);
  useEffect(() => {
    ttsStalledRef.current = ttsStalled;
  }, [ttsStalled]);
  useEffect(() => {
    ttsAutoNextRef.current = ttsAutoNext;
  }, [ttsAutoNext]);
  useEffect(() => {
    ttsRateRef.current = ttsRate;
  }, [ttsRate]);
  useEffect(() => {
    ttsVoiceIdRef.current = ttsVoiceId;
  }, [ttsVoiceId]);

  // Load saved TTS settings
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

  const saveTtsSettings = useCallback(
    async (voiceId: string | undefined, rate: number, autoNext?: boolean) => {
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
    },
    [],
  );

  const clearWatchdogTimer = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    ttsIndexRef.current = -1;
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

  // Speaks a sentence that's been split on TTS_PAUSE_MARKER (i.e. it had
  // one or more brackets in it), one chunk at a time, with a real
  // TTS_PAUSE_MS silence between chunks. Only used when a sentence
  // actually contains the marker - ordinary sentences never go through
  // this and are spoken exactly as before, in one Speech.speak() call.
  const speakChunks = useCallback(
    (
      chunks: string[],
      chunkIdx: number,
      onAllDone: () => void,
      onChunkError: () => void,
    ) => {
      if (!isMountedRef.current || !ttsActiveRef.current) return;
      if (chunkIdx >= chunks.length) {
        onAllDone();
        return;
      }
      const chunk = chunks[chunkIdx].trim();
      const isLast = chunkIdx === chunks.length - 1;
      const advance = () => {
        if (!isMountedRef.current || !ttsActiveRef.current) return;
        if (isLast) {
          onAllDone();
        } else {
          setTimeout(() => {
            if (!isMountedRef.current || !ttsActiveRef.current) return;
            speakChunks(chunks, chunkIdx + 1, onAllDone, onChunkError);
          }, TTS_PAUSE_MS);
        }
      };
      if (!chunk) {
        // Nothing but the bracket marker on this side (e.g. the sentence
        // starts or ends right at "[") - still honor the pause, just
        // don't call Speech.speak on empty text.
        advance();
        return;
      }
      try {
        try {
          Speech.stop();
        } catch {}
        Speech.speak(chunk, {
          language: "en",
          pitch: 1.0,
          rate: ttsRateRef.current,
          voice: ttsVoiceIdRef.current,
          onDone: advance,
          onError: (err) => {
            console.warn("[TTS] Error speaking chunk:", err);
            onChunkError();
          },
        });
      } catch (err) {
        console.error("[TTS] Unexpected error speaking chunk:", err);
        onChunkError();
      }
    },
    [],
  );

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
          novel &&
          chapterIndex + 1 < novel.chapters.length
        ) {
          if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
          setAutoNextCountdownActive(true);
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});

          try {
            Speech.speak("Loading next chapter", {
              language: "en",
              pitch: 1.0,
              rate: ttsRateRef.current,
              voice: ttsVoiceIdRef.current,
            });
          } catch {}

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

          autoNextTimerRef.current = setTimeout(() => {
            autoNextTimerRef.current = null;
            setAutoNextCountdownActive(false);
            if (!isMountedRef.current || !ttsAutoNextRef.current) return;
            goToNextChapter();
          }, 3000);
        }
        return;
      }
      ttsIndexRef.current = index;
      setTtsIndex(index);

      clearWatchdogTimer();

      const rawText = sentences[index];
      const pauseCount = rawText.split(TTS_PAUSE_MARKER).length - 1;
      const wordCount = rawText
        .split(TTS_PAUSE_MARKER)
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;
      const estimatedDuration =
        Math.max(5, (wordCount / 3) * (1 / ttsRateRef.current) * 2.5) +
        pauseCount * (TTS_PAUSE_MS / 1000);

      watchdogTimerRef.current = setTimeout(() => {
        if (!ttsActiveRef.current || ttsIndexRef.current !== index) {
          return;
        }
        if (ttsStallRetryCountRef.current < 1) {
          ttsStallRetryCountRef.current += 1;
          console.log("[TTS] Watchdog: retrying stalled sentence");
          clearWatchdogTimer();
          speakSentence(sentences, index);
        } else {
          console.warn("[TTS] Watchdog: stalled permanently");
          ttsStalledRef.current = true;
          setTtsStalled(true);
          ttsActiveRef.current = false;
          setTtsActive(false);
          try {
            Speech.stop();
          } catch {}
          clearWatchdogTimer();
        }
      }, estimatedDuration * 1000);

      AccessibilityInfo.announceForAccessibility(
        `Reading: ${rawText.split(TTS_PAUSE_MARKER).join("").substring(0, 100)}`,
      );

      const onSentenceDone = () => {
        if (!isMountedRef.current) return;
        if (!ttsActiveRef.current) return;
        clearWatchdogTimer();
        ttsStallRetryCountRef.current = 0;
        ttsErrorCountRef.current = 0;
        speakSentence(sentences, index + 1);
      };

      const onSentenceError = () => {
        if (!isMountedRef.current) return;
        if (!ttsActiveRef.current) return;
        clearWatchdogTimer();
        ttsErrorCountRef.current += 1;
        if (ttsErrorCountRef.current > 3) {
          stopTTS();
          return;
        }
        speakSentence(sentences, index + 1);
      };

      if (pauseCount > 0) {
        // This sentence has one or more brackets in it - speak it in
        // pieces with a real pause where each one was, instead of one
        // continuous Speech.speak() call.
        speakChunks(
          rawText.split(TTS_PAUSE_MARKER),
          0,
          onSentenceDone,
          onSentenceError,
        );
        return;
      }

      try {
        try {
          Speech.stop();
        } catch {}
        Speech.speak(rawText, {
          language: "en",
          pitch: 1.0,
          rate: ttsRateRef.current,
          voice: ttsVoiceIdRef.current,
          onDone: onSentenceDone,
          onError: (err) => {
            console.warn("[TTS] Error speaking sentence:", err);
            onSentenceError();
          },
        });
      } catch (err) {
        console.error("[TTS] Unexpected error in speakSentence:", err);
        stopTTS();
      }
    },
    [stopTTS, clearWatchdogTimer, novel, chapterIndex, goToNextChapter, speakChunks],
  );

  // While backgrounded/screen-locked, JS timers (including the watchdog)
  // can be suspended for an arbitrary length of time. On resume, the
  // native TTS bridge may deliver several queued onDone events in one
  // burst - React collapses those into a single render, so the highlight
  // can appear to vanish and then "jump" several sentences ahead with
  // nothing shown in between, even though the underlying index itself
  // isn't wrong. Re-running speakSentence at the (now-settled) current
  // index gives React a clean, dedicated render of it and restarts the
  // watchdog against a fresh, trustworthy timer - reusing the normal
  // single-sentence path rather than duplicating its setup here.
  const wasBackgroundedRef = useRef(false);
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };
    const subscription = AppState.addEventListener("change", (next) => {
      const goingBackground =
        appStateRef.current === "active" && next.match(/inactive|background/);
      const returningForeground =
        appStateRef.current.match(/inactive|background/) && next === "active";

      if (goingBackground && ttsActiveRef.current) {
        wasBackgroundedRef.current = true;
        clearWatchdogTimer();
      }

      if (returningForeground && wasBackgroundedRef.current) {
        wasBackgroundedRef.current = false;
        if (ttsActiveRef.current && ttsSentences.length > 0) {
          ttsStallRetryCountRef.current = 0;
          const resumeIdx = Math.min(
            Math.max(ttsIndexRef.current, 0),
            ttsSentences.length - 1,
          );
          speakSentence(ttsSentences, resumeIdx);
        }
      }

      appStateRef.current = next;
    });
    return () => subscription.remove();
  }, [ttsSentences, speakSentence, clearWatchdogTimer]);

  const toggleTTS = useCallback(() => {
    if (ttsActiveRef.current) {
      stopTTS();
      return;
    }
    if (ttsStalledRef.current && ttsIndexRef.current >= 0) {
      ttsStalledRef.current = false;
      setTtsStalled(false);
      ttsStallRetryCountRef.current = 0;
      ttsActiveRef.current = true;
      setTtsActive(true);
      KeepAwake.activateKeepAwakeAsync().catch(() => {});
      clearWatchdogTimer();
      if (ttsIndexRef.current < ttsSentences.length) {
        speakSentence(ttsSentences, ttsIndexRef.current);
      } else {
        if (ttsSentences.length > 0) {
          speakSentence(ttsSentences, 0);
        }
      }
      return;
    }
    if (!ttsSentences.length) return;
    setTimeout(() => {
      if (!isMountedRef.current) return;
      if (ttsActiveRef.current) return;
      ttsActiveRef.current = true;
      setTtsActive(true);
      KeepAwake.activateKeepAwakeAsync().catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Start wherever the reader currently is, not always the top of the
      // chapter - getStartIndex reads the on-screen scroll/paragraph
      // position. Clamp defensively in case the mapping falls outside the
      // sentence array (e.g. stale ref during a chapter transition).
      const rawStart = getStartIndex ? getStartIndex() : 0;
      const startIdx = Number.isFinite(rawStart)
        ? Math.min(Math.max(rawStart, 0), ttsSentences.length - 1)
        : 0;
      speakSentence(ttsSentences, startIdx);
    }, 100);
  }, [ttsSentences, speakSentence, stopTTS, clearWatchdogTimer, getStartIndex]);

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

  const toggleTtsAutoNext = useCallback(() => {
    setTtsAutoNext((prev) => {
      const next = !prev;
      ttsAutoNextRef.current = next;
      if (!next) {
        if (autoNextTimerRef.current) {
          clearTimeout(autoNextTimerRef.current);
          autoNextTimerRef.current = null;
        }
        setAutoNextCountdownActive(false);
      }
      saveTtsSettings(ttsVoiceIdRef.current, ttsRateRef.current, next);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [saveTtsSettings]);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNextCountdownActive(false);
  }, []);

  const reloadVoices = useCallback(async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const english = voices.filter((v) =>
        v.language?.toLowerCase().startsWith("en"),
      );
      setTtsVoices(english.length > 0 ? english : voices);
    } catch (e) {
      console.warn("[TTS] Could not reload voices:", e);
    }
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.action === "auto_next_chapter") {
          goToNextChapter();
        }
      },
    );
    return () => subscription.remove();
  }, [goToNextChapter]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setupMediaSession();
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    setRemoteHandlers({
      onPlayPause: () => toggleTTS(),
      onStop: () => stopTTS(),
    });
    return () => {
      setRemoteHandlers({});
    };
  }, [toggleTTS, stopTTS]);

  useEffect(() => {
    if (novel && ttsActive) {
      const chapter = novel.chapters[chapterIndex];
      if (chapter) {
        updateMediaSession({
          novelTitle: novel.title,
          chapterNumber: chapterIndex + 1,
          chapterTitle: chapter.title,
          progressPercent: 0,
          isPlaying: true,
        });
      }
    }
  }, [ttsActive, novel, chapterIndex]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      Speech.stop();
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
      clearMediaSession();
    };
  }, []);

  return {
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
    reloadVoices, // <-- added
    showTTSSettings,
    setShowTTSSettings,
    showTTSHelp,
    setShowTTSHelp,
    cancelAutoNext,
  };
}
