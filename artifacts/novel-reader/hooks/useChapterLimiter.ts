import { useRef, useState } from "react";

// ─── Chapter Limiter thresholds ──────────────────────────────────────────
// Below CAUTION: totally normal, no visual change.
// CAUTION – DANGER-1: input turns amber, still no modal.
// DANGER and up: input turns red + a blocking modal explains the risks.
// MAX: hard ceiling, the field will not accept anything higher.
export const CHAPTER_LIMIT_MAX = 500;
export const CHAPTER_LIMIT_DANGER_THRESHOLD = 450;
export const CHAPTER_LIMIT_CAUTION_THRESHOLD = 400;

export function useChapterLimiter(maxChStr: string, setMaxChStr: (v: string) => void) {
  const [dangerModalVisible, setDangerModalVisible] = useState(false);
  // Tracks the last value we evaluated so the modal only pops once per
  // "crossing" into the danger zone, not on every keystroke while typing in it.
  const lastValueRef = useRef<number | null>(null);

  const onMaxChStrChange = (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, "");

    if (digitsOnly === "") {
      setMaxChStr("");
      lastValueRef.current = null;
      return;
    }

    let num = parseInt(digitsOnly, 10);
    if (num > CHAPTER_LIMIT_MAX) num = CHAPTER_LIMIT_MAX;
    setMaxChStr(String(num));

    const wasBelowDanger = lastValueRef.current === null || lastValueRef.current < CHAPTER_LIMIT_DANGER_THRESHOLD;
    if (num >= CHAPTER_LIMIT_DANGER_THRESHOLD && wasBelowDanger) {
      setDangerModalVisible(true);
    }
    lastValueRef.current = num;
  };

  const currentValue = parseInt(maxChStr, 10) || 0;
  const isCaution = currentValue >= CHAPTER_LIMIT_CAUTION_THRESHOLD;
  const isDanger = currentValue >= CHAPTER_LIMIT_DANGER_THRESHOLD;

  const closeDangerModal = () => setDangerModalVisible(false);

  // Used by "Lower It" in the modal, and whenever the form is reset/cleared.
  const lowerToSafeValue = () => {
    setMaxChStr(String(CHAPTER_LIMIT_CAUTION_THRESHOLD));
    lastValueRef.current = CHAPTER_LIMIT_CAUTION_THRESHOLD;
    setDangerModalVisible(false);
  };

  const resetLimiter = () => {
    lastValueRef.current = null;
    setDangerModalVisible(false);
  };

  return {
    onMaxChStrChange,
    dangerModalVisible,
    closeDangerModal,
    lowerToSafeValue,
    resetLimiter,
    isCaution,
    isDanger,
    currentValue,
  };
}
