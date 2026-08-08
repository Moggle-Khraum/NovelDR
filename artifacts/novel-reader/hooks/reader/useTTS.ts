// hooks/reader/useTTS.ts
import { useState, useEffect, useRef, useCallback } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import { AccessibilityInfo, InteractionManager } from "react-native";
import * as Notifications from "expo-notifications";
import * as FileSystem from "expo-file-system";
import { TTS_SETTINGS_FILE, TTS_MIN_CHARS } from "@/constants/readerSettings";
import {
  updateMediaSession,
  clearMediaSession,
  setupMediaSession,
  setRemoteHandlers,
} from "@/lib/TTSMediaSession";

type UseTTSProps = {
  ttsSentences: string[];
  novel: any;
  chapterIndex: number;
  goToNextChapter: () => void;
};

export function useTTS({
  ttsSentences,
  novel,
  chapterIndex,
  goToNextChapter,
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

      const wordCount = sentences[index].split(/\s+/).length;
      const estimatedDuration = Math.max(
        5,
        (wordCount / 3) * (1 / ttsRateRef.current) * 2.5,
      );

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
            speakSentence(sentences, index + 1);
          },
        });
      } catch (err) {
        console.error("[TTS] Unexpected error in speakSentence:", err);
        stopTTS();
      }
    },
    [stopTTS, clearWatchdogTimer, novel, chapterIndex, goToNextChapter],
  );

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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      speakSentence(ttsSentences, 0);
    }, 100);
  }, [ttsSentences, speakSentence, stopTTS, clearWatchdogTimer]);

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
    showTTSSettings,
    setShowTTSSettings,
    showTTSHelp,
    setShowTTSHelp,
    cancelAutoNext,
  };
}
