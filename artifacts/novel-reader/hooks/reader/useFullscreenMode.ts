import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const FADE_DURATION_MS = 300;

export function useFullscreenMode() {
  const [fullscreenMode, setFullscreenMode] = useState(false);
  // Controls whether the top/bottom bars are mounted at all. Kept true
  // during the fade-out so the opacity animation is visible, then flipped
  // false once the fade completes so the bars stop reserving layout space
  // and the content area actually expands to fill the screen.
  const [barsMounted, setBarsMounted] = useState(true);
  const uiOpacity = useSharedValue(1);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFullscreen = useCallback(() => {
    setFullscreenMode((prev) => {
      const newState = !prev;

      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }

      if (newState) {
        // Entering fullscreen: fade out, then unmount after the animation.
        uiOpacity.value = withTiming(0, { duration: FADE_DURATION_MS });
        unmountTimerRef.current = setTimeout(() => {
          setBarsMounted(false);
        }, FADE_DURATION_MS);
      } else {
        // Exiting fullscreen: mount immediately, then fade in.
        setBarsMounted(true);
        uiOpacity.value = withTiming(1, { duration: FADE_DURATION_MS });
      }

      return newState;
    });
  }, [uiOpacity]);

  useEffect(() => {
    return () => {
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    };
  }, []);

  const uiAnimatedStyle = useAnimatedStyle(() => ({
    opacity: uiOpacity.value,
  }));

  return {
    fullscreenMode,
    barsMounted,
    toggleFullscreen,
    uiAnimatedStyle,
  };
}
