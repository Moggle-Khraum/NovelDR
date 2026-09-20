import { useCallback, useRef } from "react";
import * as Haptics from "expo-haptics";
import {
  RAPID_TAP_THRESHOLD,
  RAPID_TAP_WINDOW_MS,
} from "@/constants/readerSettings";

/**
 * Detects rapid consecutive taps (likely accidental spam or gesture issues)
 * and triggers a safety response (stop TTS, stop auto-scroll, show warning).
 */
export function useRapidTapSafety(
  onTripped: () => void = () => {},
) {
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

  return {
    registerTap,
    reset,
  };
}
