// hooks/reader/useScrollTracking.ts
import { useRef, useState, useCallback, useEffect } from "react";
import { ScrollView } from "react-native";

export const USER_SCROLL_RESUME_DELAY = 2500;
export const MAX_RESTORE_ATTEMPTS = 10;
export const RESTORE_SETTLE_DELAY = 100;

type UseScrollTrackingProps = {
  novel: any;
  chapterIndex: number;
};

export function useScrollTracking({
  novel,
  chapterIndex,
}: UseScrollTrackingProps) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const isUserScrollingRef = useRef(false);
  const userScrollResumeTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const [readingProgress, setReadingProgress] = useState(0);

  const hasRestoredScrollRef = useRef(false);
  const restoredChapterRef = useRef(-1);
  const restoreAttemptsRef = useRef(0);
  const lastRestoreHeightRef = useRef(0);
  const restoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateReadingProgress = useCallback(() => {
    if (contentHeightRef.current > scrollViewHeightRef.current) {
      const maxScroll = contentHeightRef.current - scrollViewHeightRef.current;
      setReadingProgress(
        Math.min(100, Math.max(0, (scrollYRef.current / maxScroll) * 100)),
      );
    } else {
      setReadingProgress(0);
    }
  }, []);

  const handleScroll = useCallback(
    (event: any) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y;
      updateReadingProgress();
    },
    [updateReadingProgress],
  );

  const handleScrollBeginDrag = useCallback(() => {
    isUserScrollingRef.current = true;
    if (userScrollResumeTimeoutRef.current) {
      clearTimeout(userScrollResumeTimeoutRef.current);
      userScrollResumeTimeoutRef.current = null;
    }
  }, []);

  const handleScrollEndDrag = useCallback(() => {
    if (userScrollResumeTimeoutRef.current) {
      clearTimeout(userScrollResumeTimeoutRef.current);
    }
    userScrollResumeTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      userScrollResumeTimeoutRef.current = null;
    }, USER_SCROLL_RESUME_DELAY);
  }, []);

  const handleScrollViewLayout = useCallback(
    (event: any) => {
      scrollViewHeightRef.current = event.nativeEvent.layout.height;
      updateReadingProgress();
    },
    [updateReadingProgress],
  );

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      updateReadingProgress();

      if (
        hasRestoredScrollRef.current ||
        restoredChapterRef.current === chapterIndex
      )
        return;

      const savedOffset =
        novel?.lastRead?.chapterIndex === chapterIndex
          ? novel.lastRead.scrollOffset
          : 0;

      if (savedOffset <= 0 || height <= 0) {
        hasRestoredScrollRef.current = true;
        restoredChapterRef.current = chapterIndex;
        return;
      }

      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }

      restoreAttemptsRef.current += 1;
      const contentTallEnough =
        height - scrollViewHeightRef.current >= savedOffset;
      const heightSettled = height === lastRestoreHeightRef.current;
      lastRestoreHeightRef.current = height;
      const shouldFinalize =
        contentTallEnough ||
        heightSettled ||
        restoreAttemptsRef.current >= MAX_RESTORE_ATTEMPTS;

      restoreTimeoutRef.current = setTimeout(() => {
        const maxScrollNow = Math.max(
          0,
          contentHeightRef.current - scrollViewHeightRef.current,
        );
        const targetY = Math.min(savedOffset, maxScrollNow);
        scrollRef.current?.scrollTo({ y: targetY, animated: false });
        scrollYRef.current = targetY;
        updateReadingProgress();

        if (shouldFinalize) {
          hasRestoredScrollRef.current = true;
          restoredChapterRef.current = chapterIndex;
          restoreAttemptsRef.current = 0;
          lastRestoreHeightRef.current = 0;
        }
        restoreTimeoutRef.current = null;
      }, RESTORE_SETTLE_DELAY);
    },
    [novel, chapterIndex, updateReadingProgress],
  );

  useEffect(() => {
    hasRestoredScrollRef.current = false;
    restoredChapterRef.current = -1;
    restoreAttemptsRef.current = 0;
    lastRestoreHeightRef.current = 0;
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current);
      restoreTimeoutRef.current = null;
    }
  }, [chapterIndex]);

  return {
    scrollRef,
    scrollY: scrollYRef.current,
    readingProgress,
    contentHeight: contentHeightRef.current,
    scrollViewHeight: scrollViewHeightRef.current,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleScrollViewLayout,
    handleContentSizeChange,
    isUserScrollingRef,
  };
}
