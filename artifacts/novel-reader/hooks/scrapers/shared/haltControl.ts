// hooks/scrapers/shared/haltControl.ts
// One shared abort switch for a download or update run. Halt aborts the
// in-flight HTTP requests and WebView jobs at once, instead of waiting for the
// current chapter to finish.
let controller = new AbortController();
const listeners = new Set<() => void>();

/** Start a new run with a fresh, not-aborted signal. */
export const resetHalt = (): void => {
  controller = new AbortController();
};

/** Signal for the current run; pass it to network calls. */
export const haltSignal = (): AbortSignal => controller.signal;

export const isHalted = (): boolean => controller.signal.aborted;

export const haltError = (): Error => {
  const err = new Error("halted by user");
  err.name = "AbortError";
  return err;
};

/** Subscribe to the halt; returns an unsubscribe function. */
export const onHalt = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Abort everything in the current run. Safe to call more than once. */
export const haltNow = (): void => {
  if (controller.signal.aborted) return;
  controller.abort();
  for (const listener of Array.from(listeners)) listener();
};
