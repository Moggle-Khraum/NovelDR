import { useEffect } from "react";
import * as FileSystem from "expo-file-system";

// Local, on-device crash trail - independent of Sentry. This exists because
// Dave works mobile-only with no CLI/adb access: if Sentry fails to upload
// (crash happened offline, or before init finished), there's otherwise no
// way to see what happened without a computer. This file is small, rotates
// at 500KB, and can be exported from Settings via Sharing.shareAsync.
const CRASH_LOG_DIR = `${FileSystem.documentDirectory}NovelDR/`;
const CRASH_LOG_PATH = `${CRASH_LOG_DIR}crash-log.txt`;
const MAX_LOG_SIZE_BYTES = 500 * 1024;
const TRIM_TO_BYTES = 350 * 1024; // trim well below the cap so we're not rewriting every single error

let writeQueue: Promise<void> = Promise.resolve();

function formatEntry(kind: string, error: unknown, extra?: string): string {
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
  return `[${timestamp}] [${kind}]${extra ? ` (${extra})` : ""} ${message}${stack}\n---\n`;
}

async function appendToCrashLog(entry: string): Promise<void> {
  // Queue writes so overlapping errors (e.g. a fatal error that triggers a
  // second error while handling the first) don't race on the same file.
  writeQueue = writeQueue
    .then(async () => {
      try {
        const dirInfo = await FileSystem.getInfoAsync(CRASH_LOG_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(CRASH_LOG_DIR, {
            intermediates: true,
          });
        }

        const fileInfo = await FileSystem.getInfoAsync(CRASH_LOG_PATH);
        let existing = "";
        if (fileInfo.exists) {
          if (fileInfo.size && fileInfo.size > MAX_LOG_SIZE_BYTES) {
            // Rotate: keep only the most recent slice instead of deleting
            // everything, so a burst of errors doesn't wipe useful history.
            const full = await FileSystem.readAsStringAsync(CRASH_LOG_PATH);
            existing = full.slice(-TRIM_TO_BYTES);
            const boundary = existing.indexOf("\n---\n");
            if (boundary !== -1) {
              existing = existing.slice(boundary + 5);
            }
          } else {
            existing = await FileSystem.readAsStringAsync(CRASH_LOG_PATH);
          }
        }

        await FileSystem.writeAsStringAsync(CRASH_LOG_PATH, existing + entry);
      } catch {
        // If the log itself can't be written, there's nothing further to do -
        // Sentry (if reachable) is still the primary reporting path.
      }
    })
    .catch(() => {});

  return writeQueue;
}

/**
 * Installs process-wide crash capture: uncaught JS errors and unhandled
 * promise rejections. React render errors are already handled separately
 * by <ErrorBoundary>. Both paths here write to the local rotating log AND
 * chain to whatever handler was previously registered (Sentry's, installed
 * via Sentry.init in _layout.tsx) so neither system is disabled by the other.
 *
 * Call once, at the root, before other providers mount.
 */
export function useCrashLogger(): void {
  useEffect(() => {
    const globalAny = global as any;

    // --- Uncaught JS errors (outside React's render cycle) ---
    const previousErrorHandler = globalAny.ErrorUtils?.getGlobalHandler?.();

    globalAny.ErrorUtils?.setGlobalHandler(
      (error: Error, isFatal?: boolean) => {
        appendToCrashLog(
          formatEntry("JS_ERROR", error, isFatal ? "fatal" : "non-fatal"),
        );
        // Preserve whatever was there before (Sentry's handler, and
        // eventually React Native's default red-box/dev behavior).
        previousErrorHandler?.(error, isFatal);
      },
    );

    // --- Unhandled promise rejections (Hermes-native tracking) ---
    const hermesInternal = globalAny.HermesInternal;
    if (hermesInternal?.enablePromiseRejectionTracker) {
      hermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id: number, error: unknown) => {
          appendToCrashLog(formatEntry("UNHANDLED_REJECTION", error));
        },
        onHandled: () => {},
      });
    }

    return () => {
      if (previousErrorHandler) {
        globalAny.ErrorUtils?.setGlobalHandler(previousErrorHandler);
      }
    };
  }, []);
}

/** Path used by Settings to share/export the log. */
export const CRASH_LOG_FILE_PATH = CRASH_LOG_PATH;

/** Manually log a caught error (e.g. from a try/catch you don't want to rethrow). */
export function logCaughtError(error: unknown, context?: string): void {
  appendToCrashLog(formatEntry("CAUGHT", error, context));
}

/** Used by the ErrorBoundary's onError so render errors land in the same file. */
export function logRenderError(error: Error, componentStack: string): void {
  appendToCrashLog(
    formatEntry("RENDER_ERROR", error, componentStack.slice(0, 200)),
  );
}
