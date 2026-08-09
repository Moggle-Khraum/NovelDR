import { useCallback, useState } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture } from "react-native-gesture-handler";

type UseFullscreenModeParams = {
  onDoubleTap: () => void;
};

export function useFullscreenMode({ onDoubleTap }: UseFullscreenModeParams) {
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const uiOpacity = useSharedValue(1);

  const toggleFullscreen = useCallback(() => {
    setFullscreenMode((prev) => {
      const newState = !prev;
      uiOpacity.value = withTiming(newState ? 0 : 1, { duration: 300 });
      return newState;
    });
  }, [uiOpacity]);

  // Bars stay mounted; opacity animates and pointerEvents disables
  // interaction while hidden, instead of being unmounted (which was
  // skipping the fade entirely).
  const uiAnimatedStyle = useAnimatedStyle(() => ({
    opacity: uiOpacity.value,
  }));

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(onDoubleTap)();
    });

  return {
    fullscreenMode,
    toggleFullscreen,
    uiAnimatedStyle,
    doubleTapGesture,
  };
}
