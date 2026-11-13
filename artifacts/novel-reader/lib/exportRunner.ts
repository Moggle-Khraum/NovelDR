// Runs a long-novel export: one chapter at a time, part by part.
//
// Rules:
// - Before starting, the free space must cover the minimum (about 100 MB) or
//   the estimated output, whichever is larger. Otherwise nothing is written.
// - Each chapter is read and staged to disk alone, so the whole book is never
//   held in memory.
// - A finished part is renamed from its temporary name to its final name. Only
//   finished parts ever carry a final name.
// - Cancel and errors stop between chapters. The part in progress is discarded.
//   Finished parts are kept.
// - Finished parts are zipped from disk with a note saying what is complete.
//
// The file system, the part builder, and the zip step are injected by the app,
// so this logic can be tested without a device.

import type { ExportPlan, ExportPart } from "./exportPlan";

export const MIN_FREE_BYTES = 100 * 1024 * 1024;

export type ExportEvent = {
  level: "info" | "ok" | "warn" | "error";
  text: string;
};

export type ExportPhase =
  | "checking"
  | "reading"
  | "building"
  | "packaging"
  | "done"
  | "cancelled"
  | "failed"
  | "refused";

export type ExportProgress = {
  phase: ExportPhase;
  chaptersDone: number;
  chaptersTotal: number;
  partNumber?: number;
  partTotal?: number;
};

export type RunnerDeps = {
  freeBytes: () => Promise<number>;
  readChapter: (
    position: number,
  ) => Promise<{ title: string; content: string } | null>;
  stageChapter: (
    partNumber: number,
    position: number,
    title: string,
    content: string,
  ) => Promise<void>;
  buildPart: (partNumber: number, partTotal: number) => Promise<string>;
  finishPart: (tempPath: string, partNumber: number) => Promise<string>;
  discardPart: (partNumber: number) => Promise<void>;
  zipParts: (files: string[], note: string) => Promise<string>;
};

export type RunnerOptions = {
  isCancelled: () => boolean;
  minFreeBytes?: number;
  // Estimated output size. Used when it is larger than the minimum.
  estimatedOutputBytes?: number;
  onEvent?: (event: ExportEvent) => void;
  onProgress?: (progress: ExportProgress) => void;
};

export type RunnerResult = {
  phase: "done" | "cancelled" | "failed" | "refused";
  completedParts: string[];
  zipPath?: string;
  missingChapters: number;
  note: string;
  error?: string;
};

export function requiredFreeBytes(options: {
  minFreeBytes?: number;
  estimatedOutputBytes?: number;
}): number {
  const minimum = options.minFreeBytes ?? MIN_FREE_BYTES;
  return Math.max(minimum, options.estimatedOutputBytes ?? 0);
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function buildNote(input: {
  total: number;
  completed: number;
  stoppedAt?: number;
  reason?: string;
}): string {
  const { total, completed, stoppedAt, reason } = input;
  if (completed === total && !stoppedAt) {
    return `All ${total} part${total === 1 ? "" : "s"} complete.`;
  }
  const failedAt = stoppedAt ?? completed + 1;
  const lines = [
    reason
      ? `Stopped at part ${failedAt} of ${total}: ${reason}`
      : `Stopped at part ${failedAt} of ${total}.`,
  ];
  if (completed > 0) {
    lines.push(
      completed === 1
        ? "Part 1 is complete."
        : `Parts 1 to ${completed} are complete.`,
    );
  } else {
    lines.push("No parts were completed.");
  }
  return lines.join(" ");
}

export async function runLongExport(
  plan: ExportPlan,
  deps: RunnerDeps,
  options: RunnerOptions,
): Promise<RunnerResult> {
  const emit = (level: ExportEvent["level"], text: string) =>
    options.onEvent?.({ level, text });
  const progress = (p: Partial<ExportProgress> & { phase: ExportPhase }) =>
    options.onProgress?.({
      chaptersDone: 0,
      chaptersTotal: plan.chapterCount,
      ...p,
    });

  // 1. Space check. Refuse before writing anything.
  progress({ phase: "checking" });
  const free = await deps.freeBytes();
  const required = requiredFreeBytes(options);
  if (free < required) {
    const message = `Not enough free space: ${formatMb(free)} free, ${formatMb(required)} needed.`;
    emit("error", message);
    progress({ phase: "refused" });
    return {
      phase: "refused",
      completedParts: [],
      missingChapters: 0,
      note: message,
      error: message,
    };
  }
  emit("ok", `Free space checked: ${formatMb(free)} available.`);

  const completedParts: string[] = [];
  let missingChapters = 0;
  let chaptersDone = 0;

  const total = plan.parts.length;

  for (const part of plan.parts) {
    emit(
      "info",
      `Starting part ${part.number} of ${total} (chapters ${part.firstChapter}-${part.lastChapter}).`,
    );

    // Stop at a part boundary if cancelled.
    if (options.isCancelled()) {
      return finish("cancelled", completedParts, total, part.number, undefined);
    }

    const partResult = await runPart(part, total, deps, options, {
      emit,
      progress,
      chaptersDone,
      chaptersTotal: plan.chapterCount,
    });

    chaptersDone = partResult.chaptersDone;
    missingChapters += partResult.missing;

    if (partResult.outcome === "ok") {
      completedParts.push(partResult.finalPath);
      emit("ok", `Part ${part.number} of ${total} written.`);
      continue;
    }

    // Part did not finish. Its partial output is already discarded.
    if (partResult.outcome === "cancelled") {
      emit(
        "warn",
        `Cancelled during part ${part.number} of ${total}. The unfinished part was discarded.`,
      );
      return finish("cancelled", completedParts, total, part.number, undefined);
    }

    emit(
      "error",
      `Part ${part.number} failed: ${partResult.error}. The unfinished part was discarded.`,
    );
    return finish(
      "failed",
      completedParts,
      total,
      part.number,
      partResult.error,
    );
  }

  return finish("done", completedParts, total, undefined, undefined);

  async function finish(
    phase: "done" | "cancelled" | "failed",
    files: string[],
    partTotal: number,
    stoppedAt: number | undefined,
    reason: string | undefined,
  ): Promise<RunnerResult> {
    const note = buildNote({
      total: partTotal,
      completed: files.length,
      stoppedAt: phase === "done" ? undefined : stoppedAt,
      reason: phase === "failed" ? reason : undefined,
    });

    let zipPath: string | undefined;
    if (files.length > 0) {
      progress({
        phase: "packaging",
        chaptersDone,
        chaptersTotal: plan.chapterCount,
      });
      emit("info", "Packaging finished parts into one zip.");
      try {
        zipPath = await deps.zipParts(files, note);
        emit("ok", "Zip ready to share.");
      } catch (error: any) {
        const message = error?.message || "The zip could not be created.";
        emit("error", message);
        progress({
          phase: "failed",
          chaptersDone,
          chaptersTotal: plan.chapterCount,
        });
        return {
          phase: "failed",
          completedParts: files,
          missingChapters,
          note,
          error: message,
        };
      }
    } else {
      emit("warn", "No parts were finished, so there is nothing to share.");
    }

    progress({ phase, chaptersDone, chaptersTotal: plan.chapterCount });
    return {
      phase,
      completedParts: files,
      zipPath,
      missingChapters,
      note,
      error: phase === "failed" ? reason : undefined,
    };
  }
}

type PartOutcome =
  | { outcome: "ok"; finalPath: string; chaptersDone: number; missing: number }
  | { outcome: "cancelled"; chaptersDone: number; missing: number }
  | { outcome: "failed"; error: string; chaptersDone: number; missing: number };

async function runPart(
  part: ExportPart,
  total: number,
  deps: RunnerDeps,
  options: RunnerOptions,
  ctx: {
    emit: (level: ExportEvent["level"], text: string) => void;
    progress: (p: Partial<ExportProgress> & { phase: ExportPhase }) => void;
    chaptersDone: number;
    chaptersTotal: number;
  },
): Promise<PartOutcome> {
  let chaptersDone = ctx.chaptersDone;
  let missing = 0;

  try {
    // Stage each chapter alone, in reading order.
    for (const chapter of part.chapters) {
      if (options.isCancelled()) {
        await deps.discardPart(part.number);
        return { outcome: "cancelled", chaptersDone, missing };
      }

      ctx.progress({
        phase: "reading",
        chaptersDone,
        chaptersTotal: ctx.chaptersTotal,
        partNumber: part.number,
        partTotal: total,
      });

      const data = await deps.readChapter(chapter.index);
      const position = chapter.index + 1;
      let title: string;
      let content: string;
      if (data && data.content.trim().length > 0) {
        title = data.title || `Chapter ${position}`;
        content = data.content;
      } else {
        missing++;
        title = `Chapter ${position}`;
        content =
          "[This chapter has no saved content. Re-download it from the Updates tab.]";
        ctx.emit(
          "warn",
          `Chapter ${position} has no saved content, placeholder used.`,
        );
      }

      await deps.stageChapter(part.number, position, title, content);
      chaptersDone++;
      ctx.emit(
        "info",
        `Chapter ${position} written, about ${Math.max(1, Math.round(content.length / 1024))} KB.`,
      );
    }

    if (options.isCancelled()) {
      await deps.discardPart(part.number);
      return { outcome: "cancelled", chaptersDone, missing };
    }

    ctx.progress({
      phase: "building",
      chaptersDone,
      chaptersTotal: ctx.chaptersTotal,
      partNumber: part.number,
      partTotal: total,
    });
    ctx.emit("info", `Building part ${part.number} of ${total}.`);
    const tempPath = await deps.buildPart(part.number, total);

    const finalPath = await deps.finishPart(tempPath, part.number);
    return { outcome: "ok", finalPath, chaptersDone, missing };
  } catch (error: any) {
    await deps.discardPart(part.number).catch(() => {});
    return {
      outcome: "failed",
      error: error?.message || "An unknown error stopped this part.",
      chaptersDone,
      missing,
    };
  }
}
