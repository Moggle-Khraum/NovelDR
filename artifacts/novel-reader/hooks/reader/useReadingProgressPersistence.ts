import { useEffect } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { Novel } from "@/types";

/**
 * Automatically saves reading progress when the app enters background
 * and when the component unmounts.
 */
export function useReadingProgressPersistence(
  novel: Novel | undefined,
  chapter: any | undefined,
  chapterIndex: number,
  scrollY: number,
  onSaveProgress: (
    novelId: string,
    chapterIndex: number,
    chapterTitle: string,
    scrollY: number,
  ) => void,
) {
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        (appStateRef.current === "active" &&
          nextAppState.match(/inactive|background/)) ||
        nextAppState === "background"
      ) {
        if (novel && chapter) {
          onSaveProgress(novel.id, chapterIndex, chapter.title, scrollY);
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    // Save on unmount
    return () => {
      subscription.remove();
      if (novel && chapter) {
        onSaveProgress(novel.id, chapterIndex, chapter.title, scrollY);
      }
    };
  }, [novel, chapter, chapterIndex, scrollY, onSaveProgress]);
}
