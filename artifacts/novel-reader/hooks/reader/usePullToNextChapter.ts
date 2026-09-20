import { useEffect, useRef, useState } from "react";
import { PanResponder } from "react-native";

const PULL_THRESHOLD = 90; // px of upward drag needed to trigger

export type PullStage = "idle" | "keep-pulling" | "almost-there" | "release";

export const PULL_STAGE_TEXT: Record<PullStage, string> = {
  idle: "Pull for next chapter",
  "keep-pulling": "Keep pulling...",
  "almost-there": "Almost there",
  release: "Release for next chapter",
};

function stageFor(progress: number): PullStage {
  if (progress >= 1) return "release";
  if (progress >= 0.75) return "almost-there";
  if (progress >= 0.35) return "keep-pulling";
  return "idle";
}

/**
 * Fullscreen-mode pull-to-next-chapter gesture. Only arms once the caller
 * reports the scroll view is at the bottom; drags upward from there fill
 * pullProgress (0-1), and a release at 1 fires onTriggerNext. Releasing
 * early resets to 0 with no navigation.
 *
 * isAtBottom/onTriggerNext/enabled are read through refs, not closed over
 * directly, because PanResponder.create() only runs once (on first
 * render) — without refs, the responder's callbacks would keep using
 * whatever those args were on that first render forever, the same
 * stale-closure trap useAutoScroll's setInterval fell into.
 */
export function usePullToNextChapter(
  isAtBottom: () => boolean,
  onTriggerNext: () => void,
  enabled: boolean = true,
) {
  const [pullProgress, setPullProgress] = useState(0);

  const isAtBottomRef = useRef(isAtBottom);
  const onTriggerNextRef = useRef(onTriggerNext);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);
  useEffect(() => {
    onTriggerNextRef.current = onTriggerNext;
  }, [onTriggerNext]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        if (!enabledRef.current) return false;
        // Claim the gesture only once at the bottom and dragging upward —
        // lets normal scrolling pass through untouched everywhere else.
        return isAtBottomRef.current() && gesture.dy < -8;
      },
      onPanResponderMove: (_evt, gesture) => {
        const dist = Math.max(0, -gesture.dy);
        setPullProgress(Math.min(1, dist / PULL_THRESHOLD));
      },
      onPanResponderRelease: (_evt, gesture) => {
        const dist = Math.max(0, -gesture.dy);
        const progress = Math.min(1, dist / PULL_THRESHOLD);
        setPullProgress(0);
        if (progress >= 1) {
          onTriggerNextRef.current();
        }
      },
      onPanResponderTerminate: () => {
        setPullProgress(0);
      },
    }),
  ).current;

  const stage = stageFor(pullProgress);

  return {
    pullPanHandlers: panResponder.panHandlers,
    pullProgress,
    pullStage: stage,
    pullStageText: PULL_STAGE_TEXT[stage],
  };
}
