import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Sentry from "@sentry/react-native";

export type Chapter = {
  title: string;
  url: string;
  content?: string;
  chapterNumber?: number;
};

export type NovelStatus = "unread" | "reading" | "completed";

export type Novel = {
  id: string;
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string;
  sourceUrl: string;
  chapters: Chapter[];
  dateAdded: number;
  status: NovelStatus;
  // Bumped on every real mutation (progress, status, chapters, metadata).
  // Used by restore's conflict-aware merge to decide which side - current
  // library or an incoming backup - is actually more recent per novel,
  // instead of always assuming local wins.
  lastModified?: number;
  lastRead?: {
    chapterIndex: number;
    chapterTitle: string;
    scrollOffset: number;
    timestamp?: number;
  };
};

export type SortOrder = "ascending" | "descending";

// =============================================================================
// CONCURRENCY POOL (copied from settings.tsx for self‑containment)
// =============================================================================

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  let active = 0;
  let index = 0;
  let reject: (reason?: any) => void;

  return new Promise((resolve, rejectFn) => {
    reject = rejectFn;
    const next = async () => {
      if (queue.length === 0 && active === 0) {
        resolve(results);
        return;
      }
      while (active < concurrency && queue.length > 0) {
        const item = queue.shift()!;
        const idx = index++;
        active++;
        fn(item, idx)
          .then((res) => {
            results[idx] = res;
            active--;
            next();
          })
          .catch((err) => {
            reject(err);
          });
      }
    };
    next();
  });
}

// =============================================================================
// FILE SYSTEM PATHS
// =============================================================================

const APP_FOLDER_NAME = "NovelDR";
const LIBRARY_FILE_NAME = "novel_library_v1.json";
const SORT_PREFERENCE_FILE_NAME = "chapter_sort_preference.json";
const CHAPTERS_FOLDER_NAME = "chapters";
const INIT_FLAG_FILE_NAME = ".initialized";

// New per‑novel file architecture
const NOVELS_FOLDER_NAME = "novels";
const INDEX_FILE_NAME = "novel_index_v2.json";

const POSSIBLE_STORAGE_LOCATIONS = [
  () => `${FileSystem.documentDirectory}${APP_FOLDER_NAME}/`,
  () => `${FileSystem.documentDirectory}noveldr/`,
  () => `${FileSystem.cacheDirectory}../${APP_FOLDER_NAME}/`,
  () =>
    `${FileSystem.documentDirectory}ExponentExperience/data/${APP_FOLDER_NAME}/`,
];

const getAppStoragePath = () =>
  `${FileSystem.documentDirectory}${APP_FOLDER_NAME}/`;
const getLibraryFilePath = () => `${getAppStoragePath()}${LIBRARY_FILE_NAME}`;
const getSortPreferenceFilePath = () =>
  `${getAppStoragePath()}${SORT_PREFERENCE_FILE_NAME}`;
const getChaptersPath = () => `${getAppStoragePath()}${CHAPTERS_FOLDER_NAME}/`;
const getNovelChaptersPath = (novelId: string) =>
  `${getChaptersPath()}${novelId}/`;
const getChapterFilePath = (novelId: string, chapterIndex: number) =>
  `${getNovelChaptersPath(novelId)}chapter_${chapterIndex}.json`;
const getInitFlagPath = () => `${getAppStoragePath()}${INIT_FLAG_FILE_NAME}`;

// New paths
const getNovelsPath = () => `${getAppStoragePath()}${NOVELS_FOLDER_NAME}/`;
const getNovelFilePath = (novelId: string) =>
  `${getNovelsPath()}${novelId}.json`;
const getIndexFilePath = () => `${getAppStoragePath()}${INDEX_FILE_NAME}`;

type NovelIndex = {
  novelIds: string[];
  sortOrder: SortOrder;
};

// =============================================================================
// DIRECTORY & FILE HELPERS
// =============================================================================

const ensureAppDirectoryExists = async () => {
  const appDir = getAppStoragePath();
  const dirInfo = await FileSystem.getInfoAsync(appDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
  }
};

const ensureDirectoryExists = async (dirPath: string) => {
  const dirInfo = await FileSystem.getInfoAsync(dirPath);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  }
};

const copyDirectory = async (fromPath: string, toPath: string) => {
  await ensureDirectoryExists(toPath);
  try {
    const items = await FileSystem.readDirectoryAsync(fromPath);
    for (const item of items) {
      const sourceItemPath = `${fromPath}${item}`;
      const destItemPath = `${toPath}${item}`;
      try {
        const itemInfo = await FileSystem.getInfoAsync(sourceItemPath);
        if (itemInfo.exists && itemInfo.isDirectory) {
          await copyDirectory(sourceItemPath, destItemPath);
        } else if (itemInfo.exists) {
          await FileSystem.copyAsync({
            from: sourceItemPath,
            to: destItemPath,
          });
        }
      } catch (copyError) {
        console.error(`[Recovery] Failed to copy ${item}:`, copyError);
      }
    }
  } catch (readError) {
    console.error("[Recovery] Failed to read directory:", readError);
  }
};

// Per-file write queue: serializes concurrent writes/deletes targeting the
// same destination path so overlapping calls (e.g. a resume-triggered save
// racing an in-flight save) can never collide on the same tmp file or clobber
// each other's output. Writes to different files still run concurrently.
const fileWriteQueues = new Map<string, Promise<void>>();

const withFileLock = async <T,>(
  filePath: string,
  task: () => Promise<T>,
): Promise<T> => {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fileWriteQueues.set(
    filePath,
    previous.then(() => gate),
  );

  await previous;
  try {
    return await task();
  } finally {
    release!();
    // Clean up the map entry if nothing else queued behind us, so it
    // doesn't grow unbounded over a long session.
    if (fileWriteQueues.get(filePath) === previous.then(() => gate)) {
      fileWriteQueues.delete(filePath);
    }
  }
};

// Atomic write: write to a uniquely-named .tmp file then move it into place
// (delete existing dest for Android). Serialized per destination path via
// withFileLock so concurrent writers targeting the same novel/index file
// can't race each other's tmp file or move.
const writeJsonFileAtomic = async (filePath: string, data: any) => {
  await withFileLock(filePath, async () => {
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}`;
    try {
      await FileSystem.writeAsStringAsync(tempPath, JSON.stringify(data));
      // Android's moveAsync fails if destination exists, so delete it first
      const destInfo = await FileSystem.getInfoAsync(filePath);
      if (destInfo.exists) {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
      await FileSystem.moveAsync({ from: tempPath, to: filePath });
    } catch (error) {
      // Best-effort cleanup of the tmp file if the write/move failed partway.
      await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(
        () => {},
      );
      throw error;
    }
  });
};

const saveToFile = async (filePath: string, data: any) => {
  await ensureAppDirectoryExists();
  await writeJsonFileAtomic(filePath, data);
};

const loadFromFile = async (filePath: string): Promise<string | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (!fileInfo.exists) return null;
    return await FileSystem.readAsStringAsync(filePath);
  } catch {
    return null;
  }
};

const deleteFile = async (filePath: string) => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(filePath);
    }
  } catch (error) {
    console.error("[Storage] Error deleting file:", error);
  }
};

// Per‑novel file writes
const writeNovelFile = async (novel: Novel) => {
  await ensureDirectoryExists(getNovelsPath());
  await writeJsonFileAtomic(getNovelFilePath(novel.id), novel);
};

const writeIndexFile = async (index: NovelIndex) => {
  await ensureAppDirectoryExists();
  await writeJsonFileAtomic(getIndexFilePath(), index);
};

const deleteNovelFile = async (novelId: string) => {
  await deleteFile(getNovelFilePath(novelId));
};

// Chapter file helpers (unchanged)
const saveChapterToFile = async (
  novelId: string,
  chapterIndex: number,
  chapterData: {
    title: string;
    url: string;
    content: string;
    chapterNumber?: number;
  },
) => {
  await ensureDirectoryExists(getNovelChaptersPath(novelId));
  await FileSystem.writeAsStringAsync(
    getChapterFilePath(novelId, chapterIndex),
    JSON.stringify(chapterData),
  );
};

const loadChapterFromFile = async (
  novelId: string,
  chapterIndex: number,
): Promise<Chapter | null> => {
  try {
    const content = await loadFromFile(
      getChapterFilePath(novelId, chapterIndex),
    );
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  }
};

const deleteNovelChapters = async (novelId: string) => {
  try {
    const novelChaptersDir = getNovelChaptersPath(novelId);
    const dirInfo = await FileSystem.getInfoAsync(novelChaptersDir);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(novelChaptersDir, { idempotent: true });
    }
  } catch (error) {
    console.error("[Storage] Error deleting chapters:", error);
  }
};

const saveAllChaptersToFile = async (
  novelId: string,
  chapters: Chapter[],
  offset: number = 0,
) => {
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].content) {
      await saveChapterToFile(novelId, offset + i, {
        title: chapters[i].title,
        url: chapters[i].url,
        content: chapters[i].content!,
        chapterNumber: chapters[i].chapterNumber,
      });
    }
  }
};

// =============================================================================
// INITIALIZATION FLAG
// =============================================================================

const isInitialized = async (): Promise<boolean> => {
  try {
    const info = await FileSystem.getInfoAsync(getInitFlagPath());
    return info.exists;
  } catch {
    return false;
  }
};

const markInitialized = async () => {
  await ensureAppDirectoryExists();
  await FileSystem.writeAsStringAsync(getInitFlagPath(), Date.now().toString());
};

// =============================================================================
// MIGRATION & RECOVERY
// =============================================================================

const LEGACY_ASYNC_KEYS = {
  LIBRARY: "novel_library_v1",
  SORT_PREFERENCE: "chapter_sort_preference",
  FONT_SIZE: "reader_font_size_idx",
  LINE_SPACING: "reader_line_spacing_idx",
};

type InitStep = {
  id: string;
  message: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
};

// ── Migration from old monolithic library to per‑novel files ───────────────

const migrateToPerNovelFiles = async (
  onStep: (step: InitStep) => void,
): Promise<boolean> => {
  const stepId = "migrate-per-novel";
  onStep({
    id: stepId,
    message: "Checking for legacy library structure...",
    status: "running",
  });

  try {
    // If index already exists, we're already on the new structure
    const indexInfo = await FileSystem.getInfoAsync(getIndexFilePath());
    if (indexInfo.exists) {
      onStep({
        id: stepId,
        message: "Already using per‑novel files",
        status: "done",
        detail: "Index exists",
      });
      return false;
    }

    // Check for old library blob
    const oldLibraryContent = await loadFromFile(getLibraryFilePath());
    if (!oldLibraryContent) {
      // No old library – create empty index and novels folder
      await ensureDirectoryExists(getNovelsPath());
      await writeIndexFile({ novelIds: [], sortOrder: "ascending" });
      onStep({
        id: stepId,
        message: "No legacy data found – empty library initialized",
        status: "done",
      });
      return false;
    }

    onStep({
      id: stepId,
      message: "Found legacy library – migrating to per‑novel files...",
      status: "running",
    });

    const novels: Novel[] = JSON.parse(oldLibraryContent);
    if (!Array.isArray(novels) || novels.length === 0) {
      // Empty or invalid library – just create empty index
      await ensureDirectoryExists(getNovelsPath());
      await writeIndexFile({ novelIds: [], sortOrder: "ascending" });
      onStep({
        id: stepId,
        message: "Legacy library empty – new structure created",
        status: "done",
      });
      // Rename old file to avoid re‑attempt
      const backupPath = getLibraryFilePath() + ".migrated";
      await FileSystem.moveAsync({
        from: getLibraryFilePath(),
        to: backupPath,
      });
      return true;
    }

    // Write each novel file in parallel with concurrency=12
    await ensureDirectoryExists(getNovelsPath());

    // Pre‑allocate array to preserve original order
    const novelIdsArray: (string | null)[] = new Array(novels.length).fill(
      null,
    );
    const failedIds: string[] = [];
    let succeeded = 0;
    let failed = 0;
    const total = novels.length;

    // Update progress after each completion
    const updateProgress = () => {
      onStep({
        id: stepId,
        message: `Migrating ${succeeded + failed}/${total} novels...`,
        status: "running",
        detail: `${succeeded} succeeded, ${failed} failed`,
      });
    };

    await runConcurrent(novels, 12, async (novel, idx) => {
      try {
        await writeNovelFile(novel);
        succeeded++;
        novelIdsArray[idx] = novel.id;
        updateProgress();
      } catch (error) {
        failed++;
        failedIds.push(novel.id);
        // Report to Sentry
        Sentry.captureException(error, {
          tags: { context: "migrateToPerNovelFiles" },
          extra: { novelId: novel.id, novelTitle: novel.title },
        });
        console.error(`[Migration] Failed to write novel ${novel.id}:`, error);
        updateProgress();
      }
    });

    // Filter out nulls to get the final ordered list
    const novelIds = novelIdsArray.filter((id): id is string => id !== null);

    // Read old sort preference
    let sortOrder: SortOrder = "ascending";
    const sortContent = await loadFromFile(getSortPreferenceFilePath());
    if (sortContent) {
      try {
        sortOrder = JSON.parse(sortContent);
      } catch {}
    }

    // Write index (only for successfully migrated novels)
    await writeIndexFile({ novelIds, sortOrder });

    // Clean up old files (rename to .migrated)
    const libraryBackup = getLibraryFilePath() + ".migrated";
    await FileSystem.moveAsync({
      from: getLibraryFilePath(),
      to: libraryBackup,
    });
    const sortBackup = getSortPreferenceFilePath() + ".migrated";
    const sortExists = await FileSystem.getInfoAsync(
      getSortPreferenceFilePath(),
    );
    if (sortExists.exists) {
      await FileSystem.moveAsync({
        from: getSortPreferenceFilePath(),
        to: sortBackup,
      });
    }

    // Final status
    if (failed === 0) {
      onStep({
        id: stepId,
        message: `✅ Migrated ${succeeded} novel(s) to per‑novel files`,
        status: "done",
      });
    } else {
      // Partial success
      let detail = `${succeeded} succeeded, ${failed} failed`;
      if (failedIds.length > 0) {
        const sample = failedIds.slice(0, 3).join(", ");
        detail += ` — failed IDs: ${sample}${failedIds.length > 3 ? ` and ${failedIds.length - 3} more` : ""}`;
      }
      onStep({
        id: stepId,
        message: `⚠️ Migration completed with ${failed} error(s)`,
        status: "done",
        detail,
      });
    }
    return true;
  } catch (error: any) {
    onStep({
      id: stepId,
      message: "Migration failed",
      status: "error",
      detail: error.message,
    });
    return false;
  }
};

// ── Legacy AsyncStorage migration (unchanged) ─────────────────────────────

const migrateFromLegacyStorage = async (
  onStep: (step: InitStep) => void,
): Promise<boolean> => {
  const stepId = "migrate";
  onStep({
    id: stepId,
    message: "Checking for legacy data...",
    status: "running",
  });

  try {
    let AsyncStorage;
    try {
      AsyncStorage =
        require("@react-native-async-storage/async-storage").default;
    } catch {
      onStep({
        id: stepId,
        message: "Legacy storage not available",
        status: "done",
        detail: "Skipped",
      });
      return false;
    }

    const libraryFileInfo = await FileSystem.getInfoAsync(getLibraryFilePath());
    if (libraryFileInfo.exists) {
      onStep({
        id: stepId,
        message: "Already migrated",
        status: "done",
        detail: "Library data present",
      });
      return false;
    }

    const legacyLibraryData = await AsyncStorage.getItem(
      LEGACY_ASYNC_KEYS.LIBRARY,
    );
    if (!legacyLibraryData) {
      onStep({ id: stepId, message: "No legacy data found", status: "done" });
      return false;
    }

    onStep({
      id: stepId,
      message: "Found legacy data! Migrating...",
      status: "running",
    });

    const parsed = JSON.parse(legacyLibraryData);
    await saveToFile(getLibraryFilePath(), parsed);
    const novelCount = Array.isArray(parsed) ? parsed.length : 0;

    const legacySort = await AsyncStorage.getItem(
      LEGACY_ASYNC_KEYS.SORT_PREFERENCE,
    );
    if (legacySort) {
      await saveToFile(getSortPreferenceFilePath(), legacySort);
    }

    onStep({
      id: stepId,
      message: `Migrated ${novelCount} novel(s)`,
      status: "done",
      detail: "✓ Data migrated to file system",
    });
    return true;
  } catch (error: any) {
    onStep({
      id: stepId,
      message: "Migration failed",
      status: "error",
      detail: error.message,
    });
    return false;
  }
};

// ── Recovery (unchanged) ─────────────────────────────────────────────────

const recoverDataIfNeeded = async (
  onStep: (step: InitStep) => void,
): Promise<boolean> => {
  const stepId = "recover";

  try {
    const libraryContent = await loadFromFile(getLibraryFilePath());
    if (libraryContent) {
      JSON.parse(libraryContent);
      return false;
    }

    onStep({
      id: stepId,
      message: "Attempting recovery...",
      status: "running",
    });

    for (const getLocation of POSSIBLE_STORAGE_LOCATIONS) {
      const location = getLocation();
      if (location === getAppStoragePath()) continue;

      try {
        const backup = await loadFromFile(`${location}${LIBRARY_FILE_NAME}`);
        if (backup) {
          JSON.parse(backup);
          await copyDirectory(location, getAppStoragePath());
          onStep({
            id: stepId,
            message: "Recovery successful",
            status: "done",
            detail: "Data restored from backup",
          });
          return true;
        }
      } catch {
        continue;
      }
    }

    onStep({ id: stepId, message: "No backup found", status: "done" });
    return false;
  } catch (error: any) {
    onStep({
      id: stepId,
      message: "Recovery skipped",
      status: "done",
      detail: error.message,
    });
    return false;
  }
};

// ── Orphan purging (unchanged logic, uses novel ids) ────────────────────

const purgeOrphanedChapterFiles = async (
  novelId: string,
  validChapterCount: number,
): Promise<number> => {
  try {
    const dir = getNovelChaptersPath(novelId);
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(dir);
    let purged = 0;

    for (const file of files) {
      const match = file.match(/^chapter_(\d+)\.json$/);
      if (!match) continue;

      const idx = parseInt(match[1], 10);
      if (idx >= validChapterCount) {
        await FileSystem.deleteAsync(`${dir}${file}`, { idempotent: true });
        purged++;
      }
    }

    return purged;
  } catch (error) {
    console.error("[Storage] Error purging orphaned chapter files:", error);
    return 0;
  }
};

const purgeOrphanedNovelDirectories = async (
  validNovelIds: Set<string>,
): Promise<number> => {
  try {
    const chaptersRoot = getChaptersPath();
    const rootInfo = await FileSystem.getInfoAsync(chaptersRoot);
    if (!rootInfo.exists) return 0;

    const dirs = await FileSystem.readDirectoryAsync(chaptersRoot);
    let purged = 0;

    for (const dir of dirs) {
      if (!validNovelIds.has(dir)) {
        await FileSystem.deleteAsync(getNovelChaptersPath(dir), {
          idempotent: true,
        });
        purged++;
      }
    }

    return purged;
  } catch (error) {
    console.error("[Storage] Error purging orphaned novel directories:", error);
    return 0;
  }
};

const purgeOrphanedDataOnStartup = async (
  loadedNovels: Novel[],
): Promise<{ dirs: number; files: number }> => {
  const validIds = new Set(loadedNovels.map((n) => n.id));
  const purgedDirs = await purgeOrphanedNovelDirectories(validIds);

  let purgedFiles = 0;
  for (const novel of loadedNovels) {
    purgedFiles += await purgeOrphanedChapterFiles(
      novel.id,
      novel.chapters.length,
    );
  }

  return { dirs: purgedDirs, files: purgedFiles };
};

const extractChapterNumber = (chapter: Chapter): number | null => {
  const titleMatch = (chapter.title || "").match(/chapter\s*(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1], 10);

  const urlMatch = (chapter.url || "").match(/chapter[-/](\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1], 10);

  return null;
};

// =============================================================================
// CONTEXT
// =============================================================================

type LibraryContextType = {
  novels: Novel[];
  loading: boolean;
  initSteps: InitStep[];
  initComplete: boolean;
  addNovel: (novel: Novel) => Promise<void>;
  updateNovel: (id: string, updates: Partial<Novel>) => Promise<void>;
  removeNovel: (id: string) => Promise<void>;
  removeNovels: (ids: string[]) => Promise<void>;
  getNovel: (id: string) => Novel | undefined;
  saveReadingProgress: (
    novelId: string,
    chapterIndex: number,
    chapterTitle: string,
    scrollOffset: number,
  ) => Promise<void>;
  setNovelStatus: (novelId: string, status: NovelStatus) => Promise<void>;
  sortOrder: SortOrder;
  toggleSortOrder: () => Promise<void>;
  getSortedChapters: (chapters: Chapter[]) => Chapter[];
  saveChapterContent: (
    novelId: string,
    chapterIndex: number,
    title: string,
    url: string,
    content: string,
    chapterNumber?: number,
  ) => Promise<void>;
  saveAllChaptersToFile: (
    novelId: string,
    chapters: Chapter[],
    offset?: number,
  ) => Promise<void>;
  loadChapterContent: (
    novelId: string,
    chapterIndex: number,
  ) => Promise<Chapter | null>;
  refreshLibrary: () => Promise<void>;
  purgeOrphanedData: (
    loadedNovels?: Novel[],
  ) => Promise<{ dirs: number; files: number }>;
  deleteChapters: (
    novelId: string,
    chapterUrls: string[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<void>;
  library: Novel[];
  isRestoring: boolean;
  setRestoring: (restoring: boolean) => void;
  commitRestoredLibrary: (novels: Novel[], sortOrder?: SortOrder) => void;
  abortRestore: () => void;
  // New: bulk write for restore (settings.tsx should call this instead of its own atomicWriteLibrary)
  bulkWriteNovels: (novels: Novel[], sortOrder?: SortOrder) => Promise<void>;
};

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

// ── Load novels from disk (index + per‑novel files) ──────────────────────

const loadNovelsFromDisk = async (): Promise<{
  novels: Novel[];
  sortOrder: SortOrder;
}> => {
  // Read index
  let index: NovelIndex = { novelIds: [], sortOrder: "ascending" };
  try {
    const indexContent = await loadFromFile(getIndexFilePath());
    if (indexContent) {
      index = JSON.parse(indexContent);
    }
  } catch {
    // fallback to empty index
  }

  const ids = index.novelIds || [];
  const novels: Novel[] = [];

  if (ids.length === 0) {
    return { novels, sortOrder: index.sortOrder };
  }

  // Load novels in parallel with concurrency limit
  const loadOne = async (id: string): Promise<Novel | null> => {
    try {
      const content = await loadFromFile(getNovelFilePath(id));
      if (content) {
        const novel = JSON.parse(content) as Novel;
        // Ensure chapters array exists
        if (!novel.chapters) novel.chapters = [];
        return novel;
      }
      console.warn(`[Library] Novel file missing for id: ${id}`);
      return null;
    } catch (e) {
      console.error(`[Library] Failed to load novel ${id}:`, e);
      return null;
    }
  };

  const results = await runConcurrent(ids, 12, loadOne);
  for (const result of results) {
    if (result) novels.push(result);
  }

  // If some novels were missing, we could optionally clean the index here,
  // but we'll leave it to the user to refresh or re‑migrate.
  // We'll keep the loaded ones.
  return { novels, sortOrder: index.sortOrder };
};

// =============================================================================
// PROVIDER
// =============================================================================

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [novels, setNovels] = useState<Novel[]>([]);
  const novelsRef = useRef<Novel[]>(novels);
  useEffect(() => {
    novelsRef.current = novels;
  }, [novels]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<SortOrder>("ascending");
  const [initSteps, setInitSteps] = useState<InitStep[]>([]);
  const [initComplete, setInitComplete] = useState(false);

  const [isRestoring, setIsRestoring] = useState(false);
  const isRestoringRef = useRef(false);

  const addInitStep = (step: InitStep) => {
    setInitSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === step.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = step;
        return updated;
      }
      return [...prev, step];
    });
  };

  // Holds a fully‑restored novel list staged for manual reveal
  const pendingRestoreRef = useRef<{
    novels: Novel[];
    sortOrder?: SortOrder;
  } | null>(null);

  // ── Refresh library from disk ────────────────────────────────────────────

  const refreshLibrary = useCallback(async () => {
    if (isRestoringRef.current) {
      console.log("[Library] Refresh skipped during restore");
      return;
    }
    if (pendingRestoreRef.current) {
      const { novels: restored, sortOrder: order } = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      if (order) setSortOrder(order);
      setNovels(restored);
      return;
    }
    try {
      const { novels: refreshed, sortOrder: order } =
        await loadNovelsFromDisk();
      setSortOrder(order);
      setNovels(refreshed);
    } catch (error) {
      console.error("[Library] Refresh failed:", error);
    }
  }, []);

  // ── Restore lock methods ─────────────────────────────────────────────────

  const setRestoring = useCallback((restoring: boolean) => {
    isRestoringRef.current = restoring;
    setIsRestoring(restoring);
  }, []);

  const commitRestoredLibrary = useCallback(
    (restoredNovels: Novel[], order?: SortOrder) => {
      isRestoringRef.current = false;
      setIsRestoring(false);
      pendingRestoreRef.current = { novels: restoredNovels, sortOrder: order };
    },
    [],
  );

  const abortRestore = useCallback(() => {
    isRestoringRef.current = false;
    setIsRestoring(false);
    pendingRestoreRef.current = null;
  }, []);

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    const initializeStorage = async () => {
      try {
        const alreadyInitialized = await isInitialized();
        addInitStep({
          id: "start",
          message: alreadyInitialized
            ? "Loading library..."
            : "Initializing storage...",
          status: "running",
        });

        // 1. Legacy AsyncStorage migration (old code)
        await migrateFromLegacyStorage(addInitStep);
        // 2. Recover from backup (old code)
        await recoverDataIfNeeded(addInitStep);

        // 3. Migrate old monolithic library to per‑novel files
        await migrateToPerNovelFiles(addInitStep);

        // 4. Ensure directories exist
        await ensureAppDirectoryExists();
        await ensureDirectoryExists(getChaptersPath());
        await ensureDirectoryExists(getNovelsPath());

        addInitStep({
          id: "directory",
          message: "Storage ready",
          status: "done",
        });

        // 5. Load novels
        let totalChapters = 0;
        try {
          const { novels: loaded, sortOrder: order } =
            await loadNovelsFromDisk();
          setSortOrder(order);
          setNovels(loaded);
          addInitStep({
            id: "preferences",
            message: "Preferences loaded",
            status: "done",
          });

          // Count chapters for stats
          try {
            const novelDirs =
              await FileSystem.readDirectoryAsync(getChaptersPath());
            for (const dir of novelDirs) {
              const dirInfo = await FileSystem.getInfoAsync(
                getNovelChaptersPath(dir),
              );
              if (dirInfo.exists && dirInfo.isDirectory) {
                const files = await FileSystem.readDirectoryAsync(
                  getNovelChaptersPath(dir),
                );
                totalChapters += files.length;
              }
            }
          } catch {}

          addInitStep({
            id: "library",
            message: "Library loaded",
            status: "done",
            detail: `${loaded.length} novels, ${totalChapters} chapters`,
          });
        } catch (error: any) {
          addInitStep({
            id: "library",
            message: "Library repair needed",
            status: "error",
            detail: error.message,
          });
        }

        addInitStep({
          id: "start",
          message: alreadyInitialized
            ? "Loading library..."
            : "Initializing storage...",
          status: "done",
        });

        await markInitialized();

        addInitStep({
          id: "complete",
          message: "✅ Ready!",
          status: "done",
        });
        setInitComplete(true);
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (error: any) {
        addInitStep({
          id: "error",
          message: "Initialization failed",
          status: "error",
          detail: error.message,
        });
      } finally {
        setLoading(false);
      }
    };

    initializeStorage();
  }, []);

  // ── Library data management ──────────────────────────────────────────────

  // ── addNovel ──────────────────────────────────────────────────────────────

  const addNovel = useCallback(
    async (novel: Novel) => {
      const current = novelsRef.current;
      const existing = current.find((n) => n.id === novel.id);
      let updatedNovels: Novel[];
      let newChaptersToSave: Chapter[];
      let saveOffset = 0;

      if (existing) {
        const existingUrls = new Set(existing.chapters.map((ch) => ch.url));
        const newChapters = novel.chapters.filter(
          (ch) => !existingUrls.has(ch.url),
        );
        const merged = {
          ...existing,
          ...novel,
          chapters: [...existing.chapters, ...newChapters],
          lastModified: Date.now(),
        };
        updatedNovels = current.map((n) => (n.id === novel.id ? merged : n));
        newChaptersToSave = newChapters;
        saveOffset = existing.chapters.length;
      } else {
        const newNovel = { ...novel, lastModified: Date.now() };
        updatedNovels = [newNovel, ...current];
        newChaptersToSave = novel.chapters;
        saveOffset = 0;
      }

      // Write novel file (full metadata)
      const novelToWrite = updatedNovels.find((n) => n.id === novel.id)!;
      await writeNovelFile(novelToWrite);

      // Update index (add id to front)
      const currentIds = updatedNovels.map((n) => n.id);
      await writeIndexFile({ novelIds: currentIds, sortOrder });

      // Save chapters (content) separately
      await saveAllChaptersToFile(novel.id, newChaptersToSave, saveOffset);

      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);
    },
    [sortOrder],
  );

  // ── updateNovel ──────────────────────────────────────────────────────────

  const updateNovel = useCallback(
    async (id: string, updates: Partial<Novel>) => {
      const current = novelsRef.current;
      const idx = current.findIndex((n) => n.id === id);
      if (idx === -1) return;

      const updatedNovel = { ...current[idx], ...updates, lastModified: Date.now() };
      const updatedNovels = [...current];
      updatedNovels[idx] = updatedNovel;

      // Write only this novel's file
      await writeNovelFile(updatedNovel);

      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);
    },
    [],
  );

  // ── removeNovel ──────────────────────────────────────────────────────────

  const removeNovel = useCallback(
    async (id: string) => {
      const updatedNovels = novelsRef.current.filter((n) => n.id !== id);
      // Remove novel file
      await deleteNovelFile(id);
      // Update index
      const ids = updatedNovels.map((n) => n.id);
      await writeIndexFile({ novelIds: ids, sortOrder: sortOrder });
      // Delete chapters
      deleteNovelChapters(id);

      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);
    },
    [sortOrder],
  );

  // ── removeNovels ─────────────────────────────────────────────────────────

  const removeNovels = useCallback(
    async (ids: string[]) => {
      const updatedNovels = novelsRef.current.filter(
        (n) => !ids.includes(n.id),
      );
      // Delete each novel file
      await Promise.all(ids.map((id) => deleteNovelFile(id)));
      // Update index
      const newIds = updatedNovels.map((n) => n.id);
      await writeIndexFile({ novelIds: newIds, sortOrder: sortOrder });
      // Delete chapters
      ids.forEach((id) => deleteNovelChapters(id));

      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);
    },
    [sortOrder],
  );

  // ── getNovel ─────────────────────────────────────────────────────────────

  const getNovel = useCallback(
    (id: string) => novels.find((n) => n.id === id),
    [novels],
  );

  // ── saveReadingProgress ──────────────────────────────────────────────────

  const saveReadingProgress = useCallback(
    async (
      novelId: string,
      chapterIndex: number,
      chapterTitle: string,
      scrollOffset: number,
    ) => {
      await updateNovel(novelId, {
        lastRead: {
          chapterIndex,
          chapterTitle,
          scrollOffset,
          timestamp: Date.now(),
        },
        status: "reading",
      });
    },
    [updateNovel],
  );

  // ── setNovelStatus ──────────────────────────────────────────────────────

  const setNovelStatus = useCallback(
    async (novelId: string, status: NovelStatus) => {
      await updateNovel(novelId, { status });
    },
    [updateNovel],
  );

  // ── toggleSortOrder ─────────────────────────────────────────────────────

  const toggleSortOrder = useCallback(async () => {
    const next = sortOrder === "ascending" ? "descending" : "ascending";
    setSortOrder(next);
    // Update index with new sort order
    const currentIds = novelsRef.current.map((n) => n.id);
    await writeIndexFile({ novelIds: currentIds, sortOrder: next });
  }, [sortOrder]);

  // ── getSortedChapters ──────────────────────────────────────────────────

  const getSortedChapters = useCallback(
    (chapters: Chapter[]): Chapter[] => {
      if (!chapters?.length) return [];
      const sorted = [...chapters].sort((a, b) => {
        const na = extractChapterNumber(a);
        const nb = extractChapterNumber(b);
        if (na && nb) return na - nb;
        if (na) return -1;
        if (nb) return 1;
        return (a.title || "").localeCompare(b.title || "");
      });
      return sortOrder === "descending" ? sorted.reverse() : sorted;
    },
    [sortOrder],
  );

  // ── saveChapterContent ──────────────────────────────────────────────────

  const saveChapterContent = useCallback(
    async (
      novelId: string,
      chapterIndex: number,
      title: string,
      url: string,
      content: string,
      chapterNumber?: number,
    ) => {
      // Save chapter content to file
      await saveChapterToFile(novelId, chapterIndex, {
        title,
        url,
        content,
        chapterNumber,
      });

      // Update novel metadata (chapters array)
      const current = novelsRef.current;
      const idx = current.findIndex((n) => n.id === novelId);
      if (idx === -1) return;

      const novel = { ...current[idx] };
      const newChapter = { title, url, chapterNumber };
      if (chapterIndex >= novel.chapters.length) {
        novel.chapters = [...novel.chapters, newChapter];
      } else {
        const chapters = [...novel.chapters];
        chapters[chapterIndex] = { ...chapters[chapterIndex], ...newChapter };
        novel.chapters = chapters;
      }
      novel.lastModified = Date.now();

      const updatedNovels = [...current];
      updatedNovels[idx] = novel;
      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);

      // Write the novel file (only this one)
      await writeNovelFile(novel);
    },
    [],
  );

  // ── loadChapterContent ──────────────────────────────────────────────────

  const loadChapterContent = useCallback(
    async (novelId: string, chapterIndex: number) => {
      return await loadChapterFromFile(novelId, chapterIndex);
    },
    [],
  );

  // ── purgeOrphanedData ──────────────────────────────────────────────────

  const purgeOrphanedDataCb = useCallback(async (loadedNovels?: Novel[]) => {
    return await purgeOrphanedDataOnStartup(loadedNovels ?? novelsRef.current);
  }, []);

  // ── deleteChapters ──────────────────────────────────────────────────────

  const deleteChapters = useCallback(
    async (
      novelId: string,
      chapterUrls: string[],
      onProgress?: (done: number, total: number) => void,
    ) => {
      const novel = novelsRef.current.find((n) => n.id === novelId);
      if (!novel) return;

      const urlsToDelete = new Set(chapterUrls);
      const oldChapters = novel.chapters;

      const survivingContent: (Chapter | null)[] = [];
      for (let i = 0; i < oldChapters.length; i++) {
        if (urlsToDelete.has(oldChapters[i].url)) continue;
        survivingContent.push(await loadChapterFromFile(novelId, i));
      }

      const newChapters = oldChapters.filter((ch) => !urlsToDelete.has(ch.url));
      const total = survivingContent.length;

      await deleteNovelChapters(novelId);
      onProgress?.(0, total);
      for (let i = 0; i < survivingContent.length; i++) {
        const data = survivingContent[i];
        if (data?.content) {
          await saveChapterToFile(novelId, i, {
            title: data.title,
            url: data.url,
            content: data.content,
            chapterNumber: data.chapterNumber,
          });
        }
        onProgress?.(i + 1, total);
      }

      let newLastRead = novel.lastRead;
      if (novel.lastRead) {
        const oldChapter = oldChapters[novel.lastRead.chapterIndex];
        if (!oldChapter || urlsToDelete.has(oldChapter.url)) {
          newLastRead = undefined;
        } else {
          const newIndex = newChapters.findIndex(
            (ch) => ch.url === oldChapter.url,
          );
          newLastRead =
            newIndex >= 0
              ? { ...novel.lastRead, chapterIndex: newIndex }
              : undefined;
        }
      }

      const updatedNovels = novelsRef.current.map((n) =>
        n.id === novelId
          ? {
              ...n,
              chapters: newChapters,
              lastRead: newLastRead,
              lastModified: Date.now(),
            }
          : n,
      );
      const updatedNovel = updatedNovels.find((n) => n.id === novelId)!;
      novelsRef.current = updatedNovels;
      setNovels(updatedNovels);

      // Write the updated novel file
      await writeNovelFile(updatedNovel);
    },
    [],
  );

  // ── bulkWriteNovels (for restore / import) ─────────────────────────────

  const bulkWriteNovels = useCallback(
    async (novelsToWrite: Novel[], order?: SortOrder) => {
      if (!novelsToWrite.length) {
        // Write empty index
        await writeIndexFile({
          novelIds: [],
          sortOrder: order ?? sortOrder,
        });
        return;
      }

      // Write all novel files in parallel
      await ensureDirectoryExists(getNovelsPath());
      await runConcurrent(novelsToWrite, 12, async (novel) => {
        await writeNovelFile(novel);
      });

      // Write index
      const ids = novelsToWrite.map((n) => n.id);
      await writeIndexFile({
        novelIds: ids,
        sortOrder: order ?? sortOrder,
      });
    },
    [sortOrder],
  );

  // ── Context value ──────────────────────────────────────────────────────

  const contextValue = useMemo(
    () => ({
      novels,
      loading,
      initSteps,
      initComplete,
      addNovel,
      updateNovel,
      removeNovel,
      removeNovels,
      getNovel,
      saveReadingProgress,
      setNovelStatus,
      sortOrder,
      toggleSortOrder,
      getSortedChapters,
      saveChapterContent,
      saveAllChaptersToFile,
      loadChapterContent,
      refreshLibrary,
      purgeOrphanedData: purgeOrphanedDataCb,
      deleteChapters,
      library: novels,
      isRestoring,
      setRestoring,
      commitRestoredLibrary,
      abortRestore,
      bulkWriteNovels,
    }),
    [
      novels,
      loading,
      initSteps,
      initComplete,
      addNovel,
      updateNovel,
      removeNovel,
      removeNovels,
      getNovel,
      saveReadingProgress,
      setNovelStatus,
      sortOrder,
      toggleSortOrder,
      getSortedChapters,
      saveChapterContent,
      saveAllChaptersToFile,
      loadChapterContent,
      refreshLibrary,
      purgeOrphanedDataCb,
      deleteChapters,
      isRestoring,
      setRestoring,
      commitRestoredLibrary,
      abortRestore,
      bulkWriteNovels,
    ],
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibrary must be used within a LibraryProvider");
  }
  return context;
}
