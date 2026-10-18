// hooks/reader/useReaderNavigation.ts
import { useState, useCallback, useRef, useEffect } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";

type UseReaderNavigationProps = {
  novel: any;
  chapterIndex: number;
  setChapterIndex: (index: number) => void;
  saveReadingProgress: (
    novelId: string,
    chapterIndex: number,
    chapterTitle: string,
    scrollOffset: number,
  ) => void;
  stopAutoScroll: () => void;
  stopTTS: () => void;
  cancelAutoNext: () => void;
  scrollY: number;
};

export function useReaderNavigation({
  novel,
  chapterIndex,
  setChapterIndex,
  saveReadingProgress,
  stopAutoScroll,
  stopTTS,
  cancelAutoNext,
  scrollY,
}: UseReaderNavigationProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [showTOC, setShowTOC] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const novelRef = useRef(novel);
  const chapterIndexRef = useRef(chapterIndex);
  const scrollYRef = useRef(scrollY);

  useEffect(() => {
    novelRef.current = novel;
    chapterIndexRef.current = chapterIndex;
    scrollYRef.current = scrollY;
  }, [novel, chapterIndex, scrollY]);

  const searchChapters = useCallback(
    (query: string) => {
      if (!novel) return [];
      const results: number[] = [];
      const lowerQuery = query.toLowerCase();
      novel.chapters.forEach((ch: any, idx: number) => {
        if (ch.title.toLowerCase().includes(lowerQuery)) results.push(idx);
      });
      setSearchResults(results);
      return results;
    },
    [novel],
  );

  const jumpToSearchResult = useCallback(
    (index: number) => {
      if (searchResults.length > 0 && index < searchResults.length) {
        handleChapterSelect(searchResults[index]);
        setShowSearch(false);
        setSearchQuery("");
        setSearchResults([]);
      }
    },
    [searchResults],
  );

  const goChapter = useCallback(
    (dir: 1 | -1) => {
      cancelAutoNext();
      const currentNovel = novelRef.current;
      const currentIndex = chapterIndexRef.current;
      const next = currentIndex + dir;
      if (next < 0 || next >= (currentNovel?.chapters.length ?? 0)) {
        Alert.alert(
          "Navigation",
          dir === -1 ? "First chapter reached" : "Last chapter reached",
        );
        return;
      }
      // Record the chapter we are moving TO (at the top) right away, so the
      // novel details screen / Continue button never lag one chapter behind.
      const nextChapter = currentNovel?.chapters[next];
      if (currentNovel && nextChapter) {
        saveReadingProgress(currentNovel.id, next, nextChapter.title, 0);
      }

      stopAutoScroll();
      stopTTS();
      setChapterIndex(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [
      cancelAutoNext,
      saveReadingProgress,
      stopAutoScroll,
      stopTTS,
      setChapterIndex,
    ],
  );

  const handleChapterSelect = useCallback(
    (index: number) => {
      cancelAutoNext();
      const currentNovel = novelRef.current;
      if (currentNovel && currentNovel.chapters[index]) {
        saveReadingProgress(
          currentNovel.id,
          index,
          currentNovel.chapters[index].title,
          0,
        );
      }
      setChapterIndex(index);
      setShowTOC(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [cancelAutoNext, saveReadingProgress, setChapterIndex],
  );

  const continueReading = useCallback(() => {
    const lastRead = novel?.lastRead;
    if (lastRead && lastRead.chapterIndex !== undefined) {
      setChapterIndex(lastRead.chapterIndex);
    }
  }, [novel, setChapterIndex]);

  return {
    goChapter,
    handleChapterSelect,
    continueReading,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults, // <-- added
    searchChapters,
    jumpToSearchResult,
    showTOC,
    setShowTOC,
    showSearch,
    setShowSearch,
  };
}
