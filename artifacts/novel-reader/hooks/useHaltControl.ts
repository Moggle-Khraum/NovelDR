// hooks/useHaltControl.ts
// Halt button behaviour: tap starts a 3-2-1 countdown, tapping again during the
// countdown cancels it, and at zero the run is aborted right away.
import { useCallback, useEffect, useRef, useState } from "react";
import { haltNow } from "./scrapers/shared/haltControl";

export function useHaltControl(running: boolean, onHalt: () => void) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [halting, setHalting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    if (!running) {
      clearTimer();
      setCountdown(null);
      setHalting(false);
    }
  }, [running]);

  useEffect(() => () => clearTimer(), []);

  const press = useCallback(() => {
    if (halting) return;
    if (countdown !== null) {
      clearTimer();
      setCountdown(null);
      return;
    }
    let remaining = 3;
    setCountdown(remaining);
    timerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimer();
        setCountdown(null);
        setHalting(true);
        onHalt();
        haltNow();
        return;
      }
      setCountdown(remaining);
    }, 1000);
  }, [countdown, halting, onHalt]);

  const label = halting
    ? "Halting…"
    : countdown !== null
      ? `Halting in ${countdown}… (tap to cancel)`
      : "Halt";

  return { label, press, disabled: halting };
}
