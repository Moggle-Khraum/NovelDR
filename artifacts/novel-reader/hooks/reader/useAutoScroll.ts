import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_SCROLL_SPEEDS } from "@/constants/readerSettings";

export function useAutoScroll(
  scrollRef: React.RefObject<any>,
  scrollY: number,
  contentHeight: number,
  scrollViewHeight: number,
  autoScrollSpeedIdx: number,
) {
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAutoScrollActive(false);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const speed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];
    intervalRef.current = setInterval(() => {
      if (!scrollRef.current) return;
      const currentY = scrollY;
      const maxY = Math.max(0, contentHeight - scrollViewHeight);
      if (currentY >= maxY) {
        stopAutoScroll();
        return;
      }
      const newY = Math.min(maxY, currentY + (30 * speed) / 20);
      scrollRef.current.scrollTo({ y: newY, animated: false });
    }, 50);
    setAutoScrollActive(true);
  }, [
    autoScrollSpeedIdx,
    stopAutoScroll,
    scrollY,
    contentHeight,
    scrollViewHeight,
    scrollRef,
  ]);

  // Re-arm auto-scroll when speed changes
  useEffect(() => {
    if (autoScrollActive) {
      startAutoScroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScrollSpeedIdx]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    autoScrollActive,
    startAutoScroll,
    stopAutoScroll,
  };
}
