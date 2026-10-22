import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAnimation,
  runOnJS,
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
  const fullscreenRef = useRef(false);
  const isMountedRef = useRef(true);

  // Called from the animation's completion callback, so the bars are only
  // unmounted after Reanimated has finished writing to them. Unmounting on a
  // timer that matched the fade duration could remove the views while the
  // last opacity frame was still being applied, which crashed with
  // "Unable to find viewState for tag".
  const hideBars = useCallback(() => {
    if (isMountedRef.current && fullscreenRef.current) {
      setBarsMounted(false);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const newState = !fullscreenRef.current;
    fullscreenRef.current = newState;
    setFullscreenMode(newState);

    if (newState) {
      // Entering fullscreen: fade out, then unmount once the fade finishes.
      // A cancelled fade (toggled back mid-way) reports finished=false and
      // must not unmount the bars.
      uiOpacity.value = withTiming(
        0,
        { duration: FADE_DURATION_MS },
        (finished) => {
          if (finished) runOnJS(hideBars)();
        },
      );
    } else {
      // Exiting fullscreen: mount immediately, then fade in.
      setBarsMounted(true);
      uiOpacity.value = withTiming(1, { duration: FADE_DURATION_MS });
    }
  }, [uiOpacity, hideBars]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Stop any running fade so nothing keeps updating views that are
      // being removed along with the reader screen.
      cancelAnimation(uiOpacity);
    };
  }, [uiOpacity]);

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
