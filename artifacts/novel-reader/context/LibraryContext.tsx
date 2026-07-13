import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  lastRead?: {
    chapterIndex: number;
    chapterTitle: string;
    scrollOffset: number;
  };
};

export type SortOrder = "ascending" | "descending";

// =============================================================================
// FILE SYSTEM PATHS
// =============================================================================

const APP_FOLDER_NAME = 'NovelDR';
const LIBRARY_FILE_NAME = 'novel_library_v1.json';
const SORT_PREFERENCE_FILE_NAME = 'chapter_sort_preference.json';
const CHAPTERS_FOLDER_NAME = 'chapters';
const INIT_FLAG_FILE_NAME = '.initialized';

const POSSIBLE_STORAGE_LOCATIONS = [
  () => `${FileSystem.documentDirectory}${APP_FOLDER_NAME}/`,
  () => `${FileSystem.documentDirectory}noveldr/`,
  () => `${FileSystem.cacheDirectory}../${APP_FOLDER_NAME}/`,
  () => `${FileSystem.documentDirectory}ExponentExperience/data/${APP_FOLDER_NAME}/`,
];

const getAppStoragePath = () => `${FileSystem.documentDirectory}${APP_FOLDER_NAME}/`;
const getLibraryFilePath = () => `${getAppStoragePath()}${LIBRARY_FILE_NAME}`;
const getSortPreferenceFilePath = () => `${getAppStoragePath()}${SORT_PREFERENCE_FILE_NAME}`;
const getChaptersPath = () => `${getAppStoragePath()}${CHAPTERS_FOLDER_NAME}/`;
const getNovelChaptersPath = (novelId: string) => `${getChaptersPath()}${novelId}/`;
const getChapterFilePath = (novelId: string, chapterIndex: number) => `${getNovelChaptersPath(novelId)}chapter_${chapterIndex}.json`;
const getInitFlagPath = () => `${getAppStoragePath()}${INIT_FLAG_FILE_NAME}`;

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
          await FileSystem.copyAsync({ from: sourceItemPath, to: destItemPath });
        }
      } catch (copyError) {
        console.error(`[Recovery] Failed to copy ${item}:`, copyError);
      }
    }
  } catch (readError) {
    console.error('[Recovery] Failed to read directory:', readError);
  }
};

const saveToFile = async (filePath: string, data: any) => {
  await ensureAppDirectoryExists();
  await FileSystem.writeAsStringAsync(filePath, JSON.stringify(data));
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
    console.error('[Storage] Error deleting file:', error);
  }
};

const saveChapterToFile = async (novelId: string, chapterIndex: number, chapterData: { title: string; url: string; content: string; chapterNumber?: number }) => {
  await ensureDirectoryExists(getNovelChaptersPath(novelId));
  await FileSystem.writeAsStringAsync(
    getChapterFilePath(novelId, chapterIndex),
    JSON.stringify(chapterData)
  );
};

const loadChapterFromFile = async (novelId: string, chapterIndex: number): Promise<Chapter | null> => {
  try {
    const content = await loadFromFile(getChapterFilePath(novelId, chapterIndex));
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
    console.error('[Storage] Error deleting chapters:', error);
  }
};

const saveAllChaptersToFile = async (novelId: string, chapters: Chapter[], offset: number = 0) => {
  // `offset` is the absolute index (within the novel's full chapter list) that
  // `chapters[0]` corresponds to. Callers that pass a partial/incremental batch
  // (e.g. addNovel appending to an existing novel) MUST pass the correct offset,
  // otherwise this silently overwrites chapter_0.json, chapter_1.json, etc.
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
  LIBRARY: 'novel_library_v1',
  SORT_PREFERENCE: 'chapter_sort_preference',
  FONT_SIZE: 'reader_font_size_idx',
  LINE_SPACING: 'reader_line_spacing_idx',
};

type InitStep = {
  id: string;
  message: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
};

const migrateFromLegacyStorage = async (onStep: (step: InitStep) => void): Promise<boolean> => {
  const stepId = 'migrate';
  onStep({ id: stepId, message: 'Checking for legacy data...', status: 'running' });

  try {
    let AsyncStorage;
    try {
      AsyncStorage = require('@react-native-async-storage/async-storage').default;
    } catch {
      onStep({ id: stepId, message: 'Legacy storage not available', status: 'done', detail: 'Skipped' });
      return false;
    }

    const libraryFileInfo = await FileSystem.getInfoAsync(getLibraryFilePath());
    if (libraryFileInfo.exists) {
      onStep({ id: stepId, message: 'Already migrated', status: 'done', detail: 'Library data present' });
      return false;
    }

    const legacyLibraryData = await AsyncStorage.getItem(LEGACY_ASYNC_KEYS.LIBRARY);
    if (!legacyLibraryData) {
      onStep({ id: stepId, message: 'No legacy data found', status: 'done' });
      return false;
    }

    onStep({ id: stepId, message: 'Found legacy data! Migrating...', status: 'running' });

    const parsed = JSON.parse(legacyLibraryData);
    await saveToFile(getLibraryFilePath(), parsed);
    const novelCount = Array.isArray(parsed) ? parsed.length : 0;

    const legacySort = await AsyncStorage.getItem(LEGACY_ASYNC_KEYS.SORT_PREFERENCE);
    if (legacySort) {
      await saveToFile(getSortPreferenceFilePath(), legacySort);
    }

    onStep({
      id: stepId,
      message: `Migrated ${novelCount} novel(s)`,
      status: 'done',
      detail: '✓ Data migrated to file system',
    });
    return true;
  } catch (error: any) {
    onStep({
      id: stepId,
      message: 'Migration failed',
      status: 'error',
      detail: error.message,
    });
    return false;
  }
};

const recoverDataIfNeeded = async (onStep: (step: InitStep) => void): Promise<boolean> => {
  const stepId = 'recover';

  try {
    const libraryContent = await loadFromFile(getLibraryFilePath());
    if (libraryContent) {
      JSON.parse(libraryContent);
      return false;
    }

    onStep({ id: stepId, message: 'Attempting recovery...', status: 'running' });

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
            message: 'Recovery successful',
            status: 'done',
            detail: 'Data restored from backup',
          });
          return true;
        }
      } catch {
        continue;
      }
    }

    onStep({ id: stepId, message: 'No backup found', status: 'done' });
    return false;
  } catch (error: any) {
    onStep({ id: stepId, message: 'Recovery skipped', status: 'done', detail: error.message });
    return false;
  }
};

const extractChapterNumber = (chapter: Chapter): number | null => {
  const titleMatch = (chapter.title || '').match(/chapter\s*(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1], 10);

  const urlMatch = (chapter.url || '').match(/chapter[-/](\d+)/i);
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
  saveReadingProgress: (novelId: string, chapterIndex: number, chapterTitle: string, scrollOffset: number) => Promise<void>;
  setNovelStatus: (novelId: string, status: NovelStatus) => Promise<void>;
  sortOrder: SortOrder;
  toggleSortOrder: () => void;
  getSortedChapters: (chapters: Chapter[]) => Chapter[];
  saveChapterContent: (novelId: string, chapterIndex: number, title: string, url: string, content: string, chapterNumber?: number) => Promise<void>;
  saveAllChaptersToFile: (novelId: string, chapters: Chapter[], offset?: number) => Promise<void>;
  loadChapterContent: (novelId: string, chapterIndex: number) => Promise<Chapter | null>;
  refreshLibrary: () => Promise<void>;
  library: Novel[];
};

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const loadNovelsFromDisk = async (): Promise<{ novels: Novel[], sortOrder: SortOrder }> => {
  const libraryContent = await loadFromFile(getLibraryFilePath());
  const novels: Novel[] = libraryContent ? JSON.parse(libraryContent) : [];

  const sortContent = await loadFromFile(getSortPreferenceFilePath());
  const sortOrder: SortOrder = sortContent ? JSON.parse(sortContent) : 'ascending';

  return { novels, sortOrder };
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
  const [sortOrder, setSortOrder] = useState<SortOrder>('ascending');
  const [initSteps, setInitSteps] = useState<InitStep[]>([]);
  const [initComplete, setInitComplete] = useState(false);

  const addInitStep = (step: InitStep) => {
    setInitSteps(prev => {
      const idx = prev.findIndex(s => s.id === step.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = step;
        return updated;
      }
      return [...prev, step];
    });
  };

  useEffect(() => {
    const initializeStorage = async () => {
      const initialized = await isInitialized();

      if (initialized) {
        addInitStep({ id: 'start', message: 'Loading library...', status: 'done', detail: 'Already initialized' });
        try {
          const { novels: loaded, sortOrder: order } = await loadNovelsFromDisk();
          setSortOrder(order);
          setNovels(loaded);
        } catch {}
        setInitComplete(true);
        setLoading(false);
        return;
      }

      try {
        addInitStep({ id: 'start', message: 'Initializing storage...', status: 'running' });

        const migrated = await migrateFromLegacyStorage(addInitStep);
        const recovered = await recoverDataIfNeeded(addInitStep);

        await ensureAppDirectoryExists();
        await ensureDirectoryExists(getChaptersPath());
        addInitStep({ id: 'directory', message: 'Storage ready', status: 'done' });

        let totalChapters = 0;
        try {
          const { novels: loaded, sortOrder: order } = await loadNovelsFromDisk();
          setSortOrder(order);
          setNovels(loaded);
          addInitStep({ id: 'preferences', message: 'Preferences loaded', status: 'done' });

          try {
            const novelDirs = await FileSystem.readDirectoryAsync(getChaptersPath());
            for (const dir of novelDirs) {
              const dirInfo = await FileSystem.getInfoAsync(getNovelChaptersPath(dir));
              if (dirInfo.exists && dirInfo.isDirectory) {
                const files = await FileSystem.readDirectoryAsync(getNovelChaptersPath(dir));
                totalChapters += files.length;
              }
            }
          } catch {}

          addInitStep({
            id: 'library',
            message: 'Library loaded',
            status: 'done',
            detail: `${loaded.length} novels, ${totalChapters} chapters`,
          });
        } catch {
          addInitStep({ id: 'library', message: 'Library repair needed', status: 'error' });
        }

        await markInitialized();

        addInitStep({
          id: 'complete',
          message: (migrated || recovered) ? '✅ Data restored' : '✅ Ready!',
          status: 'done',
        });
        setInitComplete(true);
        await new Promise(resolve => setTimeout(resolve, 800));

      } catch (error: any) {
        addInitStep({ id: 'error', message: 'Initialization failed', status: 'error', detail: error.message });
      } finally {
        setLoading(false);
      }
    };

    initializeStorage();
  }, [addInitStep]);

  // ── Library data management ──────────────────────────────────────────────

  const saveLibraryToFile = async (novelsData: Novel[]) => {
    const metadataOnly = novelsData.map(novel => ({
      ...novel,
      chapters: novel.chapters.map(ch => ({
        title: ch.title,
        url: ch.url,
        chapterNumber: ch.chapterNumber,
      })),
    }));
    await saveToFile(getLibraryFilePath(), metadataOnly);
  };

  const addNovel = useCallback(async (novel: Novel) => {
    const current = novelsRef.current;
    const existing = current.find(n => n.id === novel.id);
    let updatedNovels: Novel[];
    let newChaptersToSave: Chapter[];
    let saveOffset = 0;
    if (existing) {
      const existingUrls = new Set(existing.chapters.map(ch => ch.url));
      const newChapters = novel.chapters.filter(ch => !existingUrls.has(ch.url));
      const merged = { ...existing, ...novel, chapters: [...existing.chapters, ...newChapters] };
      updatedNovels = current.map(n => n.id === novel.id ? merged : n);
      newChaptersToSave = newChapters;
      // Existing novel already has files 0..existing.chapters.length-1 on disk —
      // the new batch must be written starting after those, not from 0 again.
      saveOffset = existing.chapters.length;
    } else {
      updatedNovels = [novel, ...current];
      newChaptersToSave = novel.chapters;
      saveOffset = 0;
    }
    novelsRef.current = updatedNovels;
    setNovels(updatedNovels);
    await saveAllChaptersToFile(novel.id, newChaptersToSave, saveOffset);
    await saveLibraryToFile(updatedNovels);
  }, []);

  const updateNovel = useCallback(async (id: string, updates: Partial<Novel>) => {
    const updatedNovels = novelsRef.current.map(n => n.id === id ? { ...n, ...updates } : n);
    novelsRef.current = updatedNovels;
    setNovels(updatedNovels);
    await saveLibraryToFile(updatedNovels);
  }, []);

  const removeNovel = useCallback(async (id: string) => {
    const updatedNovels = novelsRef.current.filter(n => n.id !== id);
    novelsRef.current = updatedNovels;
    setNovels(updatedNovels);
    await saveLibraryToFile(updatedNovels);
    deleteNovelChapters(id);
  }, []);

  const removeNovels = useCallback(async (ids: string[]) => {
    const updatedNovels = novelsRef.current.filter(n => !ids.includes(n.id));
    novelsRef.current = updatedNovels;
    setNovels(updatedNovels);
    await saveLibraryToFile(updatedNovels);
    ids.forEach(id => deleteNovelChapters(id));
  }, []);

  const getNovel = useCallback((id: string) => novels.find(n => n.id === id), [novels]);

  const saveReadingProgress = useCallback(async (
    novelId: string,
    chapterIndex: number,
    chapterTitle: string,
    scrollOffset: number
  ) => {
    await updateNovel(novelId, {
      lastRead: { chapterIndex, chapterTitle, scrollOffset },
      status: "reading",
    });
  }, [updateNovel]);

  const setNovelStatus = useCallback(async (novelId: string, status: NovelStatus) => {
    await updateNovel(novelId, { status });
  }, [updateNovel]);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(prev => {
      const next = prev === "ascending" ? "descending" : "ascending";
      saveToFile(getSortPreferenceFilePath(), next);
      return next;
    });
  }, []);

  const getSortedChapters = useCallback(
    (chapters: Chapter[]): Chapter[] => {
      if (!chapters?.length) return [];
      const sorted = [...chapters].sort((a, b) => {
        const na = extractChapterNumber(a);
        const nb = extractChapterNumber(b);
        if (na && nb) return na - nb;
        if (na) return -1;
        if (nb) return 1;
        return (a.title || '').localeCompare(b.title || '');
      });
      return sortOrder === "descending" ? sorted.reverse() : sorted;
    },
    [sortOrder]
  );

  const saveChapterContent = useCallback(async (
    novelId: string,
    chapterIndex: number,
    title: string,
    url: string,
    content: string,
    chapterNumber?: number
  ) => {
    await saveChapterToFile(novelId, chapterIndex, { title, url, content, chapterNumber });
    const current = novelsRef.current;
    const idx = current.findIndex(n => n.id === novelId);
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
    const updatedNovels = [...current];
    updatedNovels[idx] = novel;
    novelsRef.current = updatedNovels;
    setNovels(updatedNovels);
    await saveLibraryToFile(updatedNovels);
  }, []);

  const loadChapterContent = useCallback(async (novelId: string, chapterIndex: number) => {
    return await loadChapterFromFile(novelId, chapterIndex);
  }, []);

  // ── Refresh library from disk ────────────────────────────────────────────

  const refreshLibrary = useCallback(async () => {
    try {
      const { novels: refreshed, sortOrder: order } = await loadNovelsFromDisk();
      setSortOrder(order);
      setNovels(refreshed);
    } catch (error) {
      console.error('[Library] Refresh failed:', error);
    }
  }, []);

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
      library: novels,
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
      loadChapterContent,
      refreshLibrary,
    ]
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  return useContext(LibraryContext);
}
