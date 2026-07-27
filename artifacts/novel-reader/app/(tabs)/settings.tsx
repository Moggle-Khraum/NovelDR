import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import { zip, unzip } from "react-native-zip-archive";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
  Linking,
  AppState,
  ActivityIndicator,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import { Theme } from "@/constants/colors";
import { useUpdateContext } from "@/context/UpdateContext";

// =============================================================================
// UTILITY: Concurrency Pool
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
// IMAGE HELPERS
// =============================================================================

const saveBase64AsImage = async (
  base64: string,
  targetPath: string,
): Promise<boolean> => {
  try {
    await FileSystem.writeAsStringAsync(targetPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return true;
  } catch (error) {
    console.error("Failed to save image from base64:", error);
    return false;
  }
};

const COVER_MAX_DIMENSION = 480;
const COVER_JPEG_QUALITY = 0.6;

const compressCoverImage = async (
  sourcePath: string,
): Promise<{ uri: string; size: number } | null> => {
  try {
    const result = await ImageManipulator.manipulateAsync(
      sourcePath,
      [{ resize: { width: COVER_MAX_DIMENSION } }],
      {
        compress: COVER_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    const info = await FileSystem.getInfoAsync(result.uri);
    return { uri: result.uri, size: info.exists ? info.size || 0 : 0 };
  } catch (error) {
    console.error("Failed to compress cover:", error);
    return null;
  }
};

// =============================================================================
// THEME BUTTON
// =============================================================================

function ThemeButton({
  label,
  icon,
  themeKey,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  themeKey: Theme;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={[
        styles.themeBtn,
        {
          backgroundColor: active ? colors.accent : colors.surface,
          borderColor: active ? colors.accent : colors.border,
        },
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon as any}
        size={18}
        color={active ? "#fff" : colors.textSecondary}
      />
      <Text
        style={[
          styles.themeBtnLabel,
          { color: active ? "#fff" : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// =============================================================================
// TYPES & CONSTANTS
// =============================================================================

type ActivePanel = "comment" | "restore" | null;

type BackupFormat = "ndjson-v5" | "zip-v4" | "json-v3_5";

const BACKUP_FORMAT_LABELS: Record<BackupFormat, string> = {
  "ndjson-v5": "NDJSON (v5)",
  "zip-v4": "Zipped JSON (v4)",
  "json-v3_5": "Plain JSON (v3.5)",
};

interface BackupMetadata {
  version: number;
  exportedAt: string;
  comment: string | null;
  novelCount: number;
  totalChapters: number;
  includesChapters: boolean;
  includesCovers: boolean;
  totalCoverSize: number;
  originalCoverSize?: number;
  coverCount?: number;
  chapterPartCount?: number;
  durationMs?: number;
}

interface NovelCoverBackup {
  novelId: string;
  coverBase64: string | null;
  fileName: string;
}

interface FullBackup {
  metadata: BackupMetadata;
  libraryData: any;
  sortPreference: string;
  readerSettings: any;
  appSettings: any;
  chapters: Record<string, Record<string, any>>;
  asyncStorageData?: Record<string, string>;
  covers: NovelCoverBackup[];
}

interface BackupManifest {
  metadata: BackupMetadata;
  libraryData: any;
  sortPreference: string;
  readerSettings: any;
  appSettings: any;
  asyncStorageData?: Record<string, string>;
}

interface CoverManifestEntry {
  novelId: string;
  fileName: string;
  originalSize: number;
  compressedSize: number;
}

const CHAPTERS_PER_PART = 40;

// Helper to safely cast sort order from backup
function toSortOrder(value: string): "ascending" | "descending" {
  return value === "descending" ? "descending" : "ascending";
}

// =============================================================================
// MAIN SETTINGS SCREEN
// =============================================================================

export default function SettingsScreen() {
  const { colors, theme, setTheme } = useTheme();
  const {
    novels,
    purgeOrphanedData,
    setRestoring,
    commitRestoredLibrary,
    abortRestore,
    bulkWriteNovels,
    sortOrder,
  } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupList, setBackupList] = useState<
    {
      name: string;
      metadata: BackupMetadata | null;
      format: BackupFormat | null;
    }[]
  >([]);
  const [pendingComment, setPendingComment] = useState("");
  const [estimatedBackupSize, setEstimatedBackupSize] = useState<
    number | null
  >(null);
  const [estimatingSize, setEstimatingSize] = useState(false);
  const [showDevProfile, setShowDevProfile] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [showWarningCard, setShowWarningCard] = useState(false);
  const [operationProgress, setOperationProgress] = useState("");
  const [backupLogs, setBackupLogs] = useState<string[]>([]);
  const [showBugReport, setShowBugReport] = useState(false);
  const [alias, setAlias] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [showCredits, setShowCredits] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [lastAutoBackupAt, setLastAutoBackupAt] = useState<string | null>(null);
  const autoBackupRunningRef = useRef(false);
  const { checkNow, checkingUpdate } = useUpdateContext();

  // --------------------------------------------------------------------------
  // Live operation timer
  // --------------------------------------------------------------------------
  const [elapsedMs, setElapsedMs] = useState(0);
  const operationStartRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const logFlushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const startOperationTimer = () => {
    operationStartRef.current = Date.now();
    setElapsedMs(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - operationStartRef.current);
    }, 1000);
    if (logFlushIntervalRef.current) clearInterval(logFlushIntervalRef.current);
    logFlushIntervalRef.current = setInterval(() => {
      flushLogs();
    }, 300);
  };

  const stopOperationTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (logFlushIntervalRef.current) {
      clearInterval(logFlushIntervalRef.current);
      logFlushIntervalRef.current = null;
    }
    flushLogs();
  };

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (logFlushIntervalRef.current)
        clearInterval(logFlushIntervalRef.current);
    };
  }, []);

  const formatTimer = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  // --------------------------------------------------------------------------
  // Progress bar
  // --------------------------------------------------------------------------
  const progressRef = useRef({ done: 0, total: 0 });

  const startProgress = (total: number, label?: string) => {
    progressRef.current = { done: 0, total };
    if (label) setOperationProgress(label);
  };

  const bumpProgress = (increment: number = 1) => {
    progressRef.current.done += increment;
  };

  const endProgress = () => {
    progressRef.current.done = progressRef.current.total;
  };

  const resetProgress = () => {
    progressRef.current = { done: 0, total: 0 };
    setOperationProgress("");
  };

  // --------------------------------------------------------------------------
  // Batched logger
  // --------------------------------------------------------------------------
  const pendingLogsRef = useRef<string[]>([]);
  const logBatchSize = 25;
  const restoreLogListRef = useRef<FlatList<string>>(null);

  const flushLogs = () => {
    if (pendingLogsRef.current.length === 0) return;
    setBackupLogs((prev) => [...prev, ...pendingLogsRef.current]);
    pendingLogsRef.current = [];
  };

  const addBackupLog = (msg: string) => {
    pendingLogsRef.current.push(msg);
    if (pendingLogsRef.current.length >= logBatchSize) {
      flushLogs();
    }
  };

  // --------------------------------------------------------------------------
  // Update checker
  // --------------------------------------------------------------------------

  const handleCheckForUpdates = async () => {
    const result = await checkNow();
    if (result) {
      Alert.alert(
        `Update available: ${result.tag}`,
        "Head back to the Library screen to download it — tap the notification bell that just appeared above the reload button.",
      );
    } else {
      Alert.alert(
        "You're up to date",
        `Novel DR v${Constants.expoConfig?.version ?? ""} is the latest version.`,
      );
    }
  };

  // --------------------------------------------------------------------------
  // Paths & helpers
  // --------------------------------------------------------------------------

  const APP_DATA_DIR = `${FileSystem.documentDirectory}NovelDR/`;
  const BACKUP_DIR = `${FileSystem.documentDirectory}noveldrr-backups/`;
  const SETTINGS_FILE = `${APP_DATA_DIR}settings.json`;
  const COVERS_DIR = `${FileSystem.documentDirectory}covers/`;

  const getAsyncStorage = async () => {
    try {
      const AsyncStorage = (
        await import("@react-native-async-storage/async-storage")
      ).default;
      return AsyncStorage;
    } catch {
      return null;
    }
  };

  const loadAppSettings = useCallback(async (): Promise<
    Record<string, any>
  > => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
      if (!fileInfo.exists) return {};
      const content = await FileSystem.readAsStringAsync(SETTINGS_FILE);
      return JSON.parse(content);
    } catch {
      return {};
    }
  }, [SETTINGS_FILE]);

  const saveAppSettings = async (settings: Record<string, any>) => {
    try {
      await ensureDir(APP_DATA_DIR);
      const current = await loadAppSettings();
      const updated = { ...current, ...settings };
      await FileSystem.writeAsStringAsync(
        SETTINGS_FILE,
        JSON.stringify(updated),
      );
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  const WARNING_RECHECK_DAYS = 21;

  useEffect(() => {
    const checkWarningStatus = async () => {
      try {
        const settings = await loadAppSettings();
        const lastAckMs = settings.warningLastAcknowledgedAt
          ? new Date(settings.warningLastAcknowledgedAt).getTime()
          : 0;
        const daysSinceAck = (Date.now() - lastAckMs) / (1000 * 60 * 60 * 24);
        setShowWarningCard(daysSinceAck >= WARNING_RECHECK_DAYS);
      } catch (error) {
        console.error("Failed to check warning status:", error);
        setShowWarningCard(true);
      }
    };
    checkWarningStatus();
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") checkWarningStatus();
    });
    return () => subscription.remove();
  }, [loadAppSettings]);

  useEffect(() => {
    (async () => {
      const settings = await loadAppSettings();
      setAutoBackupEnabled(!!settings.autoBackupEnabled);
      setLastAutoBackupAt(settings.lastAutoBackupAt ?? null);
    })();
  }, [loadAppSettings]);

  const formatAutoBackupTimestamp = (iso: string): string => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const time = d.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      if (sameDay) return `Today, ${time}`;
      return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
    } catch {
      return iso;
    }
  };

  const handleToggleAutoBackup = async (value: boolean) => {
    setAutoBackupEnabled(value);
    await saveAppSettings({ autoBackupEnabled: value });
    Haptics.selectionAsync();
  };

  // --------------------------------------------------------------------------
  // AUTO-BACKUP (silent, triggered on background) — reuses the same export
  // pipeline as the manual "Backup All Data" button, minus UI chrome.
  // --------------------------------------------------------------------------

  const AUTO_BACKUP_MIN_INTERVAL_MS = 60 * 60 * 1000; // don't re-run within 1h
  const AUTO_BACKUP_RETENTION = 3; // keep only the last N auto-backups

  const performAutoBackup = useCallback(async () => {
    if (autoBackupRunningRef.current) return;
    if (novels.length === 0) return;
    if (exporting || importing) return;

    const settings = await loadAppSettings();
    if (!settings.autoBackupEnabled) return;

    const lastRun = settings.lastAutoBackupAt
      ? new Date(settings.lastAutoBackupAt).getTime()
      : 0;
    if (Date.now() - lastRun < AUTO_BACKUP_MIN_INTERVAL_MS) return;

    autoBackupRunningRef.current = true;
    try {
      try {
        await purgeOrphanedData(novels);
      } catch (e) {
        console.warn("Auto-backup: orphan purge failed", e);
      }

      await ensureDir(BACKUP_DIR);
      const dateTag = formatDateTag();
      const backupName = `noveldrr-backup-${dateTag}_auto`;
      const backupFolder = `${BACKUP_DIR}${backupName}/`;
      await ensureDir(backupFolder);

      const metadata = await exportBackupV5(
        backupFolder,
        "auto",
        novels,
        sortOrder,
      );

      const filename = `${backupName}.zip`;
      const backupPath = `${BACKUP_DIR}${filename}`;
      await zip(stripFileScheme(backupFolder), stripFileScheme(backupPath));
      await FileSystem.writeAsStringAsync(
        `${backupPath}.meta.json`,
        JSON.stringify(metadata),
      );
      await FileSystem.deleteAsync(backupFolder, { idempotent: true });

      const nowIso = new Date().toISOString();
      await saveAppSettings({ lastAutoBackupAt: nowIso });
      setLastAutoBackupAt(nowIso);

      // Retention: keep only the most recent AUTO_BACKUP_RETENTION auto-backups
      try {
        const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
        const autoBackups = files
          .filter((f) => f.endsWith("_auto.zip"))
          .sort()
          .reverse();
        const stale = autoBackups.slice(AUTO_BACKUP_RETENTION);
        for (const staleName of stale) {
          await FileSystem.deleteAsync(`${BACKUP_DIR}${staleName}`, {
            idempotent: true,
          });
          await FileSystem.deleteAsync(`${BACKUP_DIR}${staleName}.meta.json`, {
            idempotent: true,
          });
        }
      } catch (e) {
        console.warn("Auto-backup: retention cleanup failed", e);
      }
    } catch (e) {
      console.warn("Auto-backup failed", e);
    } finally {
      autoBackupRunningRef.current = false;
    }
  }, [
    novels,
    sortOrder,
    exporting,
    importing,
    loadAppSettings,
    AUTO_BACKUP_MIN_INTERVAL_MS,
    BACKUP_DIR,
    exportBackupV5,
    purgeOrphanedData,
    saveAppSettings,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        performAutoBackup();
      }
    });
    return () => subscription.remove();
  }, [performAutoBackup]);

  const ensureDir = async (dirPath: string) => {
    const info = await FileSystem.getInfoAsync(dirPath);
    if (!info.exists)
      await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  };

  const stripFileScheme = (path: string) => path.replace(/^file:\/\//, "");

  const formatDateTag = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  };

  const formatDuration = (ms: number): string => {
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
      return `${totalSeconds < 10 ? totalSeconds.toFixed(1) : Math.round(totalSeconds)}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
  };

  const readFileSafe = async (path: string): Promise<string | null> => {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(path);
    } catch {
      return null;
    }
  };

  // --------------------------------------------------------------------------
  // Orphan purging helpers
  // --------------------------------------------------------------------------

  const purgeOrphanedCovers = async (
    validNovelIds: Set<string>,
  ): Promise<number> => {
    try {
      const info = await FileSystem.getInfoAsync(COVERS_DIR);
      if (!info.exists) return 0;
      const files = await FileSystem.readDirectoryAsync(COVERS_DIR);
      let purged = 0;
      for (const file of files) {
        const novelId = file.replace(/\.(jpg|jpeg|png|webp)$/i, "");
        if (!validNovelIds.has(novelId)) {
          await FileSystem.deleteAsync(`${COVERS_DIR}${file}`, {
            idempotent: true,
          });
          purged++;
        }
      }
      return purged;
    } catch (error) {
      addBackupLog(`⚠️ Error purging orphaned covers: ${String(error)}`);
      return 0;
    }
  };

  // --------------------------------------------------------------------------
  // Backup format detection
  // --------------------------------------------------------------------------

  const detectBackupFormat = async (
    path: string,
  ): Promise<{ format: BackupFormat; tempDir?: string; jsonFile?: string }> => {
    if (path.toLowerCase().endsWith(".zip")) {
      const tempDir = `${FileSystem.cacheDirectory}noveldrr-restore-${Date.now()}/`;
      await ensureDir(tempDir);
      await unzip(stripFileScheme(path), stripFileScheme(tempDir));
      const manifestInfo = await FileSystem.getInfoAsync(
        `${tempDir}manifest.json`,
      );
      const chaptersDirInfo = await FileSystem.getInfoAsync(
        `${tempDir}chapters/`,
      );
      if (
        manifestInfo.exists &&
        chaptersDirInfo.exists &&
        chaptersDirInfo.isDirectory
      ) {
        return { format: "ndjson-v5", tempDir };
      }
      const files = await FileSystem.readDirectoryAsync(tempDir);
      const jsonFile = files.find((f) => f.endsWith(".json"));
      if (!jsonFile) {
        await FileSystem.deleteAsync(tempDir, { idempotent: true });
        throw new Error("No backup data found inside ZIP");
      }
      return { format: "zip-v4", tempDir, jsonFile };
    }
    return { format: "json-v3_5" };
  };

  const readBackupPreview = async (
    path: string,
  ): Promise<{ format: BackupFormat; metadata: BackupMetadata | null }> => {
    const detected = await detectBackupFormat(path);
    try {
      if (detected.format === "ndjson-v5" && detected.tempDir) {
        const raw = await FileSystem.readAsStringAsync(
          `${detected.tempDir}manifest.json`,
        );
        const manifest: BackupManifest = JSON.parse(raw);
        return { format: detected.format, metadata: manifest.metadata || null };
      }
      if (
        detected.format === "zip-v4" &&
        detected.tempDir &&
        detected.jsonFile
      ) {
        const raw = await FileSystem.readAsStringAsync(
          `${detected.tempDir}${detected.jsonFile}`,
        );
        const backup: FullBackup = JSON.parse(raw);
        return { format: detected.format, metadata: backup.metadata || null };
      }
      const raw = await FileSystem.readAsStringAsync(path);
      const backup: FullBackup = JSON.parse(raw);
      return { format: detected.format, metadata: backup.metadata || null };
    } finally {
      if (detected.tempDir)
        await FileSystem.deleteAsync(detected.tempDir, { idempotent: true });
    }
  };

  // --------------------------------------------------------------------------
  // MERGE LIBRARY DATA (no overwrite)
  // --------------------------------------------------------------------------

  const mergeLibraryData = (
    currentNovels: any[],
    backupNovels: any[],
  ): any[] => {
    const currentMap = new Map(
      (currentNovels || []).map((n: any) => [n.id, n]),
    );
    const backupMap = new Map((backupNovels || []).map((n: any) => [n.id, n]));
    const allIds = new Set([...currentMap.keys(), ...backupMap.keys()]);
    const merged: any[] = [];

    for (const id of allIds) {
      const cur = currentMap.get(id);
      const bak = backupMap.get(id);
      if (cur && bak) {
        const curChapterUrls = new Set(
          (cur.chapters || []).map((c: any) => c.url),
        );
        const extraChapters = (bak.chapters || []).filter(
          (c: any) => !curChapterUrls.has(c.url),
        );
        merged.push({
          ...bak,
          ...cur,
          chapters: [...(cur.chapters || []), ...extraChapters],
        });
      } else if (cur) {
        merged.push(cur);
      } else if (bak) {
        merged.push(bak);
      }
    }
    return merged;
  };

  // --------------------------------------------------------------------------
  // RESTORE LEGACY BACKUP (v3.5 / v4) - now using per‑novel files
  // --------------------------------------------------------------------------

  const restoreLegacyBackup = async (backup: FullBackup) => {
    pendingLogsRef.current = [];
    addBackupLog("🔄 Starting legacy restore...");
    await ensureDir(APP_DATA_DIR);

    // 1. Merge library data
    addBackupLog("📚 Merging backup with current library...");
    const mergedLibrary = mergeLibraryData(
      novels,
      Array.isArray(backup.libraryData) ? backup.libraryData : [],
    );
    addBackupLog(
      `✅ ${mergedLibrary.length} novels merged (will write after chapters/covers)`,
    );

    // 2. Restore other settings (small, can write immediately)
    if (backup.readerSettings) {
      addBackupLog("⚙️ Restoring reader settings...");
      await FileSystem.writeAsStringAsync(
        `${APP_DATA_DIR}reader_settings.json`,
        JSON.stringify(backup.readerSettings),
      );
    }
    if (backup.appSettings) await saveAppSettings(backup.appSettings);

    // 3. Restore chapters (if any) using concurrency pool
    if (backup.chapters && Object.keys(backup.chapters).length > 0) {
      const chaptersDir = `${APP_DATA_DIR}chapters/`;
      await ensureDir(chaptersDir);
      const tasks: { novelId: string; chapterIndex: number; data: any }[] = [];
      for (const [novelId, novelChapters] of Object.entries(backup.chapters)) {
        for (const [chapterIndex, data] of Object.entries(novelChapters)) {
          tasks.push({
            novelId,
            chapterIndex: parseInt(chapterIndex),
            data,
          });
        }
      }
      addBackupLog(`📄 Restoring ${tasks.length} chapters in parallel...`);

      const novelIds = new Set(tasks.map((t) => t.novelId));
      for (const novelId of novelIds) {
        await ensureDir(`${chaptersDir}${novelId}/`);
      }
      startProgress(
        tasks.length,
        `Restoring chapters for ${novelIds.size} novel${novelIds.size !== 1 ? "s" : ""}...`,
      );

      let chaptersFailed = 0;
      await runConcurrent(
        tasks,
        12,
        async ({ novelId, chapterIndex, data }) => {
          try {
            const chapterPath = `${chaptersDir}${novelId}/chapter_${chapterIndex}.json`;
            await FileSystem.writeAsStringAsync(
              chapterPath,
              JSON.stringify(data),
            );
          } catch {
            chaptersFailed++;
            addBackupLog(
              `⚠️ Failed to restore chapter ${chapterIndex} (${novelId.slice(0, 8)}...)`,
            );
          } finally {
            bumpProgress();
          }
        },
      );
      endProgress();
      addBackupLog(
        `📊 Restored ${tasks.length - chaptersFailed}/${tasks.length} chapters${chaptersFailed ? ` (${chaptersFailed} failed)` : ""}.`,
      );
    } else {
      addBackupLog("⚠️ No chapters to restore");
    }

    // 4. Restore covers (if any) using concurrency
    if (backup.covers && backup.covers.length > 0) {
      addBackupLog(`🖼️ Restoring ${backup.covers.length} novel covers...`);
      await ensureDir(COVERS_DIR);
      startProgress(backup.covers.length, "Restoring novel covers...");

      const coverMap = new Map(
        backup.covers.map((c) => [c.novelId, c.fileName]),
      );
      for (const novel of mergedLibrary) {
        const fileName = coverMap.get(novel.id);
        if (fileName) {
          novel.coverUrl = `${COVERS_DIR}${fileName}`;
        }
      }

      let coversFailed = 0;
      await runConcurrent(backup.covers, 12, async (cover) => {
        try {
          if (cover.coverBase64) {
            const coverPath = `${COVERS_DIR}${cover.fileName}`;
            const success = await saveBase64AsImage(
              cover.coverBase64,
              coverPath,
            );
            if (!success) {
              coversFailed++;
              addBackupLog(`❌ Failed: ${cover.fileName}`);
            }
          } else {
            coversFailed++;
            addBackupLog(`⚠️ No image data for ${cover.fileName}`);
          }
        } catch {
          coversFailed++;
          addBackupLog(`❌ Failed: ${cover.fileName}`);
        } finally {
          bumpProgress();
        }
      });
      endProgress();
      addBackupLog(
        `✅ Covers restored: ${backup.covers.length - coversFailed}/${backup.covers.length}${coversFailed ? ` (${coversFailed} failed)` : ""}.`,
      );
    } else {
      addBackupLog("⚠️ No covers to restore");
    }

    // 5. Now write the final library using bulkWriteNovels (per‑novel files + index)
    addBackupLog("💾 Writing merged library as per‑novel files...");
    const sortOrderFromBackup = toSortOrder(
      backup.sortPreference || "ascending",
    );
    await bulkWriteNovels(mergedLibrary, sortOrderFromBackup);

    // 6. Restore AsyncStorage data (if any)
    if (backup.asyncStorageData) {
      addBackupLog("📦 Restoring legacy data...");
      const AsyncStorage = await getAsyncStorage();
      if (AsyncStorage) {
        for (const [key, value] of Object.entries(backup.asyncStorageData)) {
          await AsyncStorage.setItem(key, value);
        }
        addBackupLog("✅ Legacy data restored");
      }
    }

    // 7. Purge orphans
    addBackupLog("🧹 Purging orphaned data...");
    try {
      const validIds = new Set<string>(
        mergedLibrary.map((n: any) => String(n.id)),
      );
      const { dirs, files } = await purgeOrphanedData(mergedLibrary);
      const purgedCovers = await purgeOrphanedCovers(validIds);
      addBackupLog(
        `✅ Purged ${dirs} stray folder(s), ${files} orphaned chapter file(s), ${purgedCovers} orphaned cover(s)`,
      );
    } catch (e) {
      addBackupLog(`⚠️ Orphan purge failed: ${String(e)}`);
    }

    flushLogs();
    addBackupLog("✅ Restore complete!");

    commitRestoredLibrary(mergedLibrary, sortOrderFromBackup);
  };

  // --------------------------------------------------------------------------
  // RESTORE V5 BACKUP (NDJSON folder) - now using per‑novel files
  // --------------------------------------------------------------------------

  const restoreBackupFromFolder = async (
    backupFolder: string,
  ): Promise<BackupMetadata> => {
    pendingLogsRef.current = [];
    addBackupLog("🔄 Starting v5 restore...");
    await ensureDir(APP_DATA_DIR);

    const manifestRaw = await FileSystem.readAsStringAsync(
      `${backupFolder}manifest.json`,
    );
    const manifest: BackupManifest = JSON.parse(manifestRaw);

    // 1. Merge library data
    addBackupLog("📚 Merging backup with current library...");
    const mergedLibrary = mergeLibraryData(
      novels,
      Array.isArray(manifest.libraryData) ? manifest.libraryData : [],
    );
    addBackupLog(
      `✅ ${mergedLibrary.length} novels merged (will write after chapters/covers)`,
    );

    // 2. Restore small settings
    if (manifest.readerSettings) {
      addBackupLog("⚙️ Restoring reader settings...");
      await FileSystem.writeAsStringAsync(
        `${APP_DATA_DIR}reader_settings.json`,
        JSON.stringify(manifest.readerSettings),
      );
    }
    if (manifest.appSettings) await saveAppSettings(manifest.appSettings);

    // 3. Chapters: read all part files, build tasks, then write with concurrency
    const backupChaptersDir = `${backupFolder}chapters/`;
    const backupChaptersDirInfo =
      await FileSystem.getInfoAsync(backupChaptersDir);
    if (backupChaptersDirInfo.exists && backupChaptersDirInfo.isDirectory) {
      const partFiles = (await FileSystem.readDirectoryAsync(backupChaptersDir))
        .filter((f) => f.startsWith("part_") && f.endsWith(".ndjson"))
        .sort();

      addBackupLog(
        `📄 Reading ${partFiles.length} part file${partFiles.length !== 1 ? "s" : ""}...`,
      );

      const chapterTasks: {
        novelId: string;
        chapterIndex: number;
        data: any;
      }[] = [];
      for (const partFile of partFiles) {
        const partRaw = await FileSystem.readAsStringAsync(
          `${backupChaptersDir}${partFile}`,
        );
        const lines = partRaw.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const { novelId, chapterIndex, ...chapterData } = entry;
            chapterTasks.push({
              novelId,
              chapterIndex: parseInt(chapterIndex),
              data: chapterData,
            });
          } catch {
            addBackupLog(`⚠️ Failed to parse a chapter entry`);
          }
        }
      }

      addBackupLog(
        `📄 Restoring ${chapterTasks.length} chapters in parallel...`,
      );
      const chaptersDir = `${APP_DATA_DIR}chapters/`;

      const novelIds = new Set(chapterTasks.map((t) => t.novelId));
      for (const novelId of novelIds) {
        await ensureDir(`${chaptersDir}${novelId}/`);
      }
      startProgress(
        chapterTasks.length,
        `Restoring chapters for ${novelIds.size} novel${novelIds.size !== 1 ? "s" : ""}...`,
      );

      let chaptersFailed = 0;
      await runConcurrent(
        chapterTasks,
        12,
        async ({ novelId, chapterIndex, data }) => {
          try {
            await FileSystem.writeAsStringAsync(
              `${chaptersDir}${novelId}/chapter_${chapterIndex}.json`,
              JSON.stringify(data),
            );
          } catch {
            chaptersFailed++;
            addBackupLog(
              `⚠️ Failed to restore chapter ${chapterIndex} (${novelId.slice(0, 8)}...)`,
            );
          } finally {
            bumpProgress();
          }
        },
      );
      endProgress();
      addBackupLog(
        `📊 Restored ${chapterTasks.length - chaptersFailed}/${chapterTasks.length} chapters${chaptersFailed ? ` (${chaptersFailed} failed)` : ""}.`,
      );
    } else {
      addBackupLog("⚠️ No chapters to restore");
    }

    // 4. Covers: read cover manifest, copy cover files
    const backupCoversDir = `${backupFolder}covers/`;
    const coversManifestPath = `${backupCoversDir}manifest.json`;
    const coversManifestInfo =
      await FileSystem.getInfoAsync(coversManifestPath);
    if (coversManifestInfo.exists) {
      const coverEntries: CoverManifestEntry[] = JSON.parse(
        await FileSystem.readAsStringAsync(coversManifestPath),
      );
      addBackupLog(`🖼️ Restoring ${coverEntries.length} novel covers...`);
      await ensureDir(COVERS_DIR);
      startProgress(coverEntries.length, "Restoring novel covers...");

      const coverMap = new Map(
        coverEntries.map((c) => [c.novelId, c.fileName]),
      );
      for (const novel of mergedLibrary) {
        const fileName = coverMap.get(novel.id);
        if (fileName) {
          novel.coverUrl = `${COVERS_DIR}${fileName}`;
        }
      }

      let coversFailed = 0;
      await runConcurrent(coverEntries, 12, async (cover) => {
        try {
          await FileSystem.copyAsync({
            from: `${backupCoversDir}${cover.fileName}`,
            to: `${COVERS_DIR}${cover.fileName}`,
          });
        } catch {
          coversFailed++;
          addBackupLog(`❌ Failed: ${cover.fileName}`);
        } finally {
          bumpProgress();
        }
      });
      endProgress();
      addBackupLog(
        `✅ Covers restored: ${coverEntries.length - coversFailed}/${coverEntries.length}${coversFailed ? ` (${coversFailed} failed)` : ""}.`,
      );
    } else {
      addBackupLog("⚠️ No covers to restore");
    }

    // 5. Write final library using bulkWriteNovels
    addBackupLog("💾 Writing merged library as per‑novel files...");
    const sortOrderFromBackup = toSortOrder(
      manifest.sortPreference || "ascending",
    );
    await bulkWriteNovels(mergedLibrary, sortOrderFromBackup);

    // 6. AsyncStorage data
    if (manifest.asyncStorageData) {
      addBackupLog("📦 Restoring legacy data...");
      const AsyncStorage = await getAsyncStorage();
      if (AsyncStorage) {
        for (const [key, value] of Object.entries(manifest.asyncStorageData)) {
          await AsyncStorage.setItem(key, value);
        }
        addBackupLog("✅ Legacy data restored");
      }
    }

    // 7. Purge orphans
    addBackupLog("🧹 Purging orphaned data...");
    try {
      const validIds = new Set<string>(
        mergedLibrary.map((n: any) => String(n.id)),
      );
      const { dirs, files } = await purgeOrphanedData(mergedLibrary);
      const purgedCovers = await purgeOrphanedCovers(validIds);
      addBackupLog(
        `✅ Purged ${dirs} stray folder(s), ${files} orphaned chapter file(s), ${purgedCovers} orphaned cover(s)`,
      );
    } catch (e) {
      addBackupLog(`⚠️ Orphan purge failed: ${String(e)}`);
    }

    flushLogs();
    addBackupLog("✅ Restore complete!");

    commitRestoredLibrary(mergedLibrary, sortOrderFromBackup);
    return manifest.metadata;
  };

  // --------------------------------------------------------------------------
  // RESTORE FROM ANY FORMAT (wrapper)
  // --------------------------------------------------------------------------

  const restoreFromAnyFormat = async (
    path: string,
  ): Promise<BackupMetadata> => {
    const detected = await detectBackupFormat(path);
    try {
      if (detected.format === "ndjson-v5" && detected.tempDir) {
        return await restoreBackupFromFolder(detected.tempDir);
      }
      if (
        detected.format === "zip-v4" &&
        detected.tempDir &&
        detected.jsonFile
      ) {
        const raw = await FileSystem.readAsStringAsync(
          `${detected.tempDir}${detected.jsonFile}`,
        );
        const backup: FullBackup = JSON.parse(raw);
        if (!backup.metadata || !backup.libraryData) {
          throw new Error("This file is not a valid NovelDR backup.");
        }
        await restoreLegacyBackup(backup);
        return backup.metadata;
      }
      // json-v3_5
      const raw = await FileSystem.readAsStringAsync(path);
      const backup: FullBackup = JSON.parse(raw);
      if (!backup.metadata || !backup.libraryData) {
        throw new Error("This file is not a valid NovelDR backup.");
      }
      await restoreLegacyBackup(backup);
      return backup.metadata;
    } finally {
      if (detected.tempDir)
        await FileSystem.deleteAsync(detected.tempDir, { idempotent: true });
    }
  };

  // --------------------------------------------------------------------------
  // EXPORT BACKUP (v5 - NDJSON) - now using in‑memory novels and sortOrder
  // --------------------------------------------------------------------------

  const exportBackupV5 = async (
    backupFolder: string,
    comment: string,
    novelsArray: typeof novels,
    currentSortOrder: typeof sortOrder,
  ): Promise<BackupMetadata> => {
    addBackupLog("📂 Preparing library data from memory...");

    const libraryData = novelsArray.map((novel) => ({
      ...novel,
      chapters: novel.chapters.map((ch) => ({
        title: ch.title,
        url: ch.url,
        chapterNumber: ch.chapterNumber,
      })),
    }));
    const novelCount = libraryData.length;
    const sortPreference = currentSortOrder;

    // Reader settings – read from file or fallback
    let readerSettings = {};
    try {
      const readerRaw = await readFileSafe(
        `${APP_DATA_DIR}reader_settings.json`,
      );
      if (readerRaw) readerSettings = JSON.parse(readerRaw);
    } catch {}

    // App settings
    const settingsData = await loadAppSettings();

    // AsyncStorage legacy data
    const AsyncStorage = await getAsyncStorage();
    let asyncStorageData: Record<string, string> = {};
    if (AsyncStorage) {
      addBackupLog("📦 Saving legacy preferences...");
      try {
        const keys = [
          "novel_library_v1",
          "chapter_sort_preference",
          "reader_font_size_idx",
          "reader_line_spacing_idx",
          "noveldr_warning_dismissed",
        ];
        for (const key of keys) {
          const value = await AsyncStorage.getItem(key);
          if (value !== null) asyncStorageData[key] = value;
        }
        addBackupLog("✅ Legacy preferences saved");
      } catch {
        addBackupLog("⚠️ Could not read all legacy settings");
      }
    }

    // ── Chapters: stream to NDJSON part files ────────────────────────────
    const chaptersDir = `${APP_DATA_DIR}chapters/`;
    const backupChaptersDir = `${backupFolder}chapters/`;
    await ensureDir(backupChaptersDir);
    addBackupLog("🔍 Scanning chapter files...");

    let totalChaptersFound = 0;
    let partIndex = 0;
    let partLines: string[] = [];

    const flushPart = async () => {
      if (partLines.length === 0) return;
      const partPath = `${backupChaptersDir}part_${String(partIndex).padStart(4, "0")}.ndjson`;
      await FileSystem.writeAsStringAsync(
        partPath,
        partLines.join("\n") + "\n",
      );
      partIndex++;
      partLines = [];
    };

    try {
      const chaptersDirInfo = await FileSystem.getInfoAsync(chaptersDir);
      if (chaptersDirInfo.exists && chaptersDirInfo.isDirectory) {
        const novelDirs = await FileSystem.readDirectoryAsync(chaptersDir);
        addBackupLog(`📁 Found ${novelDirs.length} novel directories`);
        for (const novelId of novelDirs) {
          const novelChapterDir = `${chaptersDir}${novelId}/`;
          const novelChapterInfo =
            await FileSystem.getInfoAsync(novelChapterDir);
          if (!novelChapterInfo.exists || !novelChapterInfo.isDirectory)
            continue;
          const chapterFiles =
            await FileSystem.readDirectoryAsync(novelChapterDir);
          const jsonFiles = chapterFiles.filter(
            (f) => f.startsWith("chapter_") && f.endsWith(".json"),
          );
          if (jsonFiles.length === 0) continue;

          let novelChapterCount = 0;
          for (const chapterFile of jsonFiles) {
            const chapterPath = `${novelChapterDir}${chapterFile}`;
            try {
              const chapterRaw =
                await FileSystem.readAsStringAsync(chapterPath);
              if (chapterRaw) {
                const chapterData = JSON.parse(chapterRaw);
                const chapterIndex = chapterFile
                  .replace("chapter_", "")
                  .replace(".json", "");
                partLines.push(
                  JSON.stringify({ novelId, chapterIndex, ...chapterData }),
                );
                totalChaptersFound++;
                novelChapterCount++;
                if (partLines.length >= CHAPTERS_PER_PART) await flushPart();
              }
            } catch {
              addBackupLog(`⚠️ Skipped corrupted: ${chapterFile}`);
            }
          }
          const novelData = libraryData.find((n: any) => n.id === novelId);
          const novelTitle = novelData?.title || novelId.slice(0, 12);
          addBackupLog(`   📄 ${novelTitle}: ${novelChapterCount} chapters`);
        }
        await flushPart();
        addBackupLog(`📊 Total chapters found: ${totalChaptersFound}`);
      } else {
        addBackupLog("⚠️ No chapters folder found");
        // Fallback: use the original novels (with content) instead of stripped libraryData
        if (AsyncStorage && Array.isArray(novelsArray)) {
          addBackupLog("🔍 Checking in‑memory novels for chapter content...");
          for (const novel of novelsArray) {
            if (novel.chapters && Array.isArray(novel.chapters)) {
              for (let i = 0; i < novel.chapters.length; i++) {
                if (novel.chapters[i].content) {
                  partLines.push(
                    JSON.stringify({
                      novelId: novel.id,
                      chapterIndex: i.toString(),
                      title: novel.chapters[i].title || `Chapter ${i + 1}`,
                      url: novel.chapters[i].url || "",
                      content: novel.chapters[i].content,
                    }),
                  );
                  totalChaptersFound++;
                  if (partLines.length >= CHAPTERS_PER_PART) await flushPart();
                }
              }
            }
          }
          await flushPart();
          if (totalChaptersFound > 0)
            addBackupLog(`📊 Total legacy chapters: ${totalChaptersFound}`);
        }
      }
    } catch (chaptersError) {
      addBackupLog(`❌ Error scanning chapters: ${String(chaptersError)}`);
    }

    // ── Covers ─────────────────────────────────────────────────────────────
    addBackupLog("🖼️ Scanning novel covers...");
    const backupCoversDir = `${backupFolder}covers/`;
    await ensureDir(backupCoversDir);
    const coverEntries: CoverManifestEntry[] = [];
    let totalOriginalCoverSize = 0;
    let totalCompressedCoverSize = 0;

    try {
      const coversDirInfo = await FileSystem.getInfoAsync(COVERS_DIR);
      if (coversDirInfo.exists && coversDirInfo.isDirectory) {
        const coverFiles = await FileSystem.readDirectoryAsync(COVERS_DIR);
        const imageFiles = coverFiles.filter(
          (f) =>
            f.endsWith(".jpg") ||
            f.endsWith(".jpeg") ||
            f.endsWith(".png") ||
            f.endsWith(".webp"),
        );
        addBackupLog(
          `📁 Found ${imageFiles.length} cover images in covers/ directory`,
        );
        for (const coverFile of imageFiles) {
          const coverPath = `${COVERS_DIR}${coverFile}`;
          const novelId = coverFile.replace(/\.(jpg|jpeg|png|webp)$/i, "");
          const novelExists = libraryData.some((n: any) => n.id === novelId);
          if (!novelExists) {
            addBackupLog(`   ⏭️ Skipping orphan cover: ${coverFile}`);
            continue;
          }
          const coverInfo = await FileSystem.getInfoAsync(coverPath);
          if (!coverInfo.exists) continue;
          const originalSize = coverInfo.size || 0;
          addBackupLog(
            `   🖼️ Compressing cover: ${coverFile} (${(originalSize / 1024).toFixed(1)} KB)`,
          );
          const compressed = await compressCoverImage(coverPath);
          if (!compressed) {
            addBackupLog(`   ⚠️ Failed to compress cover: ${coverFile}`);
            continue;
          }
          const destFileName = `${novelId}.jpg`;
          await FileSystem.copyAsync({
            from: compressed.uri,
            to: `${backupCoversDir}${destFileName}`,
          });
          await FileSystem.deleteAsync(compressed.uri, { idempotent: true });
          coverEntries.push({
            novelId,
            fileName: destFileName,
            originalSize,
            compressedSize: compressed.size,
          });
          totalOriginalCoverSize += originalSize;
          totalCompressedCoverSize += compressed.size;
        }
        addBackupLog(
          `📊 Covers collected: ${coverEntries.length} (${(totalCompressedCoverSize / (1024 * 1024)).toFixed(2)} MB, down from ${(totalOriginalCoverSize / (1024 * 1024)).toFixed(2)} MB)`,
        );
      } else {
        addBackupLog("⚠️ No covers directory found - no covers to backup");
      }

      if (coverEntries.length === 0 && libraryData.length > 0) {
        addBackupLog(
          "🔄 Trying to fetch remote covers for novels without local files...",
        );
        await ensureDir(COVERS_DIR);
        for (const novel of libraryData) {
          if (novel.coverUrl && novel.coverUrl.startsWith("http")) {
            try {
              const tempPath = `${COVERS_DIR}${novel.id}.jpg`;
              const result = await FileSystem.downloadAsync(
                novel.coverUrl,
                tempPath,
                {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                  },
                },
              );
              const fileInfo = await FileSystem.getInfoAsync(result.uri);
              if (fileInfo.exists && (fileInfo as any).size > 1000) {
                const originalSize = (fileInfo as any).size || 0;
                const compressed = await compressCoverImage(result.uri);
                if (compressed) {
                  const destFileName = `${novel.id}.jpg`;
                  await FileSystem.copyAsync({
                    from: compressed.uri,
                    to: `${backupCoversDir}${destFileName}`,
                  });
                  await FileSystem.deleteAsync(compressed.uri, {
                    idempotent: true,
                  });
                  coverEntries.push({
                    novelId: novel.id,
                    fileName: destFileName,
                    originalSize,
                    compressedSize: compressed.size,
                  });
                  totalOriginalCoverSize += originalSize;
                  totalCompressedCoverSize += compressed.size;
                  addBackupLog(`   ✅ Fetched remote cover: ${novel.title}`);
                }
              } else {
                addBackupLog(`   ⚠️ Cover too small or empty: ${novel.title}`);
              }
            } catch {
              addBackupLog(`   ⚠️ Could not fetch cover for: ${novel.title}`);
            }
          }
        }
        if (coverEntries.length > 0)
          addBackupLog(
            `📊 Fetched ${coverEntries.length} remote covers as fallback`,
          );
      }
    } catch (coversError) {
      addBackupLog(`❌ Error scanning covers: ${String(coversError)}`);
    }

    await FileSystem.writeAsStringAsync(
      `${backupCoversDir}manifest.json`,
      JSON.stringify(coverEntries),
    );

    // ── Small sections ────────────────────────────────────────────────────
    const metadata: BackupMetadata = {
      version: 5,
      exportedAt: new Date().toISOString(),
      comment: comment.trim() || null,
      novelCount,
      totalChapters: totalChaptersFound,
      includesChapters: totalChaptersFound > 0,
      includesCovers: coverEntries.length > 0,
      totalCoverSize: totalCompressedCoverSize,
      originalCoverSize: totalOriginalCoverSize,
      coverCount: coverEntries.length,
      chapterPartCount: partIndex,
    };

    const manifest: BackupManifest = {
      metadata,
      libraryData,
      sortPreference,
      readerSettings,
      appSettings: settingsData,
      asyncStorageData,
    };
    await FileSystem.writeAsStringAsync(
      `${backupFolder}manifest.json`,
      JSON.stringify(manifest),
    );

    addBackupLog(
      `✅ Backup ready: ${novelCount} novels, ${totalChaptersFound} chapters, ${coverEntries.length} covers`,
    );
    return metadata;
  };

  // --------------------------------------------------------------------------
  // EXPORT HANDLER
  // --------------------------------------------------------------------------

  // Lightweight size estimate — sums existing chapter/cover file sizes on
  // disk via stat calls only (no copying/zipping), so it's cheap to run
  // right before the user commits to exporting. Actual zip will be smaller
  // due to compression, so this is presented as an "uncompressed" estimate.
  const estimateBackupSize = async (): Promise<number> => {
    let total = 0;
    try {
      const chaptersDir = `${APP_DATA_DIR}chapters/`;
      const chaptersDirInfo = await FileSystem.getInfoAsync(chaptersDir);
      if (chaptersDirInfo.exists && chaptersDirInfo.isDirectory) {
        const novelDirs = await FileSystem.readDirectoryAsync(chaptersDir);
        for (const novelId of novelDirs) {
          const novelChapterDir = `${chaptersDir}${novelId}/`;
          const dirInfo = await FileSystem.getInfoAsync(novelChapterDir);
          if (!dirInfo.exists || !dirInfo.isDirectory) continue;
          const files = await FileSystem.readDirectoryAsync(novelChapterDir);
          for (const file of files) {
            const info = await FileSystem.getInfoAsync(
              `${novelChapterDir}${file}`,
            );
            if (info.exists && !info.isDirectory) total += info.size || 0;
          }
        }
      }
    } catch (e) {
      addBackupLog(`⚠️ Chapter size scan incomplete: ${String(e)}`);
    }

    try {
      const coversDirInfo = await FileSystem.getInfoAsync(COVERS_DIR);
      if (coversDirInfo.exists && coversDirInfo.isDirectory) {
        const coverFiles = await FileSystem.readDirectoryAsync(COVERS_DIR);
        for (const file of coverFiles) {
          const info = await FileSystem.getInfoAsync(`${COVERS_DIR}${file}`);
          if (info.exists && !info.isDirectory) total += info.size || 0;
        }
      }
    } catch (e) {
      addBackupLog(`⚠️ Cover size scan incomplete: ${String(e)}`);
    }

    return total;
  };

  const handleExport = () => {
    if (novels.length === 0) return;
    setPendingComment("");
    setBackupLogs([]);
    setEstimatedBackupSize(null);
    openPanel("comment");
    setEstimatingSize(true);
    estimateBackupSize()
      .then(setEstimatedBackupSize)
      .finally(() => setEstimatingSize(false));
  };

  const confirmExport = async (comment: string) => {
    const startTime = Date.now();
    try {
      closePanel();
      setExporting(true);
      startOperationTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setBackupLogs([]);
      pendingLogsRef.current = [];
      addBackupLog("🧹 Purging orphaned data before backup...");
      try {
        const validIds = new Set(novels.map((n) => n.id));
        const { dirs, files } = await purgeOrphanedData(novels);
        const purgedCovers = await purgeOrphanedCovers(validIds);
        addBackupLog(
          `✅ Purged ${dirs} stray folder(s), ${files} orphaned chapter file(s), ${purgedCovers} orphaned cover(s)`,
        );
      } catch (e) {
        addBackupLog(`⚠️ Orphan purge failed: ${String(e)}`);
      }

      await ensureDir(BACKUP_DIR);
      const dateTag = formatDateTag();
      const tag = comment
        .trim()
        .replace(/[^a-zA-Z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const backupName = `noveldrr-backup-${dateTag}${tag ? "_" + tag : ""}`;
      const backupFolder = `${BACKUP_DIR}${backupName}/`;
      await ensureDir(backupFolder);

      const metadata = await exportBackupV5(
        backupFolder,
        comment,
        novels,
        sortOrder,
      );

      addBackupLog("🗜️ Zipping backup into a single file...");
      const filename = `${backupName}.zip`;
      const backupPath = `${BACKUP_DIR}${filename}`;
      await zip(stripFileScheme(backupFolder), stripFileScheme(backupPath));

      const durationMs = Date.now() - startTime;
      metadata.durationMs = durationMs;

      await FileSystem.writeAsStringAsync(
        `${backupPath}.meta.json`,
        JSON.stringify(metadata),
      );
      await FileSystem.deleteAsync(backupFolder, { idempotent: true });

      const fileInfo = await FileSystem.getInfoAsync(backupPath);
      const sizeMB = fileInfo.exists
        ? ((fileInfo.size || 0) / (1024 * 1024)).toFixed(1)
        : "0";
      addBackupLog(
        `✅ Backup saved: ${filename} (${sizeMB} MB) in ${formatDuration(durationMs)}`,
      );
      flushLogs();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      let coverInfo = "";
      if (metadata.includesCovers) {
        coverInfo = `\n🖼️ ${metadata.coverCount} covers (${(metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB)`;
      }
      Alert.alert(
        "Backup Complete ✓",
        `Saved to: ${filename}\n\n📚 ${metadata.novelCount} novels\n📄 ${metadata.totalChapters} chapters${coverInfo}\n💾 ${sizeMB} MB\n⏱️ Finished in ${formatDuration(durationMs)}\n\nAll data backed up including covers and legacy AsyncStorage content.`,
        [
          { text: "OK" },
          {
            text: "Share Backup",
            onPress: async () => {
              const canShare = await Sharing.isAvailableAsync();
              if (canShare)
                await Sharing.shareAsync(backupPath, {
                  mimeType: "application/zip",
                  dialogTitle: "Share NovelDR Backup",
                });
            },
          },
        ],
      );
    } catch (e) {
      addBackupLog(
        `❌ Export failed after ${formatDuration(Date.now() - startTime)}: ${String(e)}`,
      );
      flushLogs();
      Alert.alert("Export Failed", String(e));
    } finally {
      setExporting(false);
      stopOperationTimer();
      resetProgress();
      flushLogs();
    }
  };

  // --------------------------------------------------------------------------
  // RESTORE UI HANDLERS
  // --------------------------------------------------------------------------

  const loadBackupList = async () => {
    try {
      await ensureDir(BACKUP_DIR);
      const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
      const allBackups = files
        .filter(
          (f) =>
            f.startsWith("noveldrr-backup-") &&
            (f.endsWith(".json") || f.endsWith(".zip")) &&
            !f.endsWith(".meta.json"),
        )
        .sort()
        .reverse();
      const backupsWithMeta = await Promise.all(
        allBackups.map(async (filename) => {
          const path = `${BACKUP_DIR}${filename}`;
          const sidecarPath = `${path}.meta.json`;
          try {
            const sidecarInfo = await FileSystem.getInfoAsync(sidecarPath);
            if (sidecarInfo.exists) {
              const raw = await FileSystem.readAsStringAsync(sidecarPath);
              const metadata: BackupMetadata = JSON.parse(raw);
              return {
                name: filename,
                metadata,
                format: "ndjson-v5" as BackupFormat,
              };
            }
            const { format, metadata } = await readBackupPreview(path);
            return { name: filename, metadata, format };
          } catch {
            return { name: filename, metadata: null, format: null };
          }
        }),
      );
      setBackupList(backupsWithMeta);
      openPanel("restore");
    } catch (e) {
      Alert.alert("Error", String(e));
    }
  };

  const handleImportBackup = async (filename: string) => {
    const backupPath = `${BACKUP_DIR}${filename}`;
    let coverInfo = "";
    let format: BackupFormat | null = null;
    try {
      const preview = await readBackupPreview(backupPath);
      format = preview.format;
      if (preview.metadata?.includesCovers) {
        const count = preview.metadata.coverCount ?? "";
        coverInfo = `\n🖼️ Includes ${count} novel covers (${(preview.metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB)`;
      }
    } catch {}
    const formatLabel = format ? ` [${BACKUP_FORMAT_LABELS[format]}]` : "";

    Alert.alert(
      "Restore Backup",
      `This will merge the backup into your current library. Novels added since this backup was made will be kept.\n\n"${filename}"${formatLabel}${coverInfo}\n\nContinue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            const startTime = Date.now();
            try {
              setImporting(true);
              setRestoring(true);
              startOperationTimer();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const metadata = await restoreFromAnyFormat(backupPath);
              const durationMs = Date.now() - startTime;
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              Alert.alert(
                "Restore Complete ✓",
                `Successfully restored:\n\n📚 ${metadata.novelCount} novels\n📄 ${metadata.totalChapters} chapters\n` +
                  (metadata.includesCovers ? `🖼️ covers included\n` : "") +
                  `⏱️ Finished in ${formatDuration(durationMs)}\n\n` +
                  `Pull to refresh (or tap the reload button) on the Library screen to see the restored data.`,
                [
                  {
                    text: "OK",
                    onPress: () => {
                      if (Platform.OS === "android")
                        IntentLauncher.startActivityAsync(
                          "android.intent.action.MAIN",
                        );
                    },
                  },
                ],
              );
              closePanel();
            } catch (e) {
              Alert.alert("Import Failed", String(e));
            } finally {
              setImporting(false);
              abortRestore();
              stopOperationTimer();
              resetProgress();
              flushLogs();
            }
          },
        },
      ],
    );
  };

  const handleImportFromPicker = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/json",
          "application/zip",
          "application/x-zip-compressed",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      Alert.alert(
        "Restore Backup",
        "This will merge the selected backup into your current library. Novels added since this backup was made will be kept.\n\nContinue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            style: "destructive",
            onPress: async () => {
              const startTime = Date.now();
              try {
                setImporting(true);
                setRestoring(true);
                openPanel("restore");
                startOperationTimer();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const metadata = await restoreFromAnyFormat(
                  result.assets[0].uri,
                );
                const durationMs = Date.now() - startTime;
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
                Alert.alert(
                  "Restore Complete ✓",
                  `Successfully restored:\n\n📚 ${metadata.novelCount} novels\n📄 ${metadata.totalChapters} chapters\n⏱️ Finished in ${formatDuration(durationMs)}\n\nPull to refresh (or tap the reload button) on the Library screen to see the restored data.`,
                  [{ text: "OK" }],
                );
                closePanel();
              } catch (e) {
                Alert.alert("Import Failed", String(e));
              } finally {
                setImporting(false);
                abortRestore();
                stopOperationTimer();
                resetProgress();
                flushLogs();
              }
            },
          },
        ],
      );
    } catch {
      Alert.alert("Error", "Failed to pick file");
    }
  };

  const handleDeleteBackup = (filename: string) => {
    Alert.alert("Delete Backup", `Delete "${filename}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await FileSystem.deleteAsync(BACKUP_DIR + filename, {
            idempotent: true,
          });
          await FileSystem.deleteAsync(`${BACKUP_DIR}${filename}.meta.json`, {
            idempotent: true,
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setBackupList((prev) => prev.filter((b) => b.name !== filename));
        },
      },
    ]);
  };

  // --------------------------------------------------------------------------
  // UI HELPERS
  // --------------------------------------------------------------------------

  const parseFilename = (filename: string) => {
    const base = filename
      .replace("noveldrr-backup-", "")
      .replace(/\.(json|zip)$/, "");
    const [datePart, timePart, ...rest] = base.split("_");
    const date = datePart ?? "";
    const time = timePart ? timePart.replace(/-/g, ":") : "";
    const tag = rest.join(" ").replace(/-/g, " ") || null;
    return { date, time, tag };
  };

  const acknowledgeWarning = async () => {
    await saveAppSettings({
      warningLastAcknowledgedAt: new Date().toISOString(),
    });
    setShowWarningCard(false);
  };

  const openUnusedAppSettings = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "android") {
      try {
        await IntentLauncher.startActivityAsync(
          "android.settings.MANAGE_UNUSED_APPS",
        );
        await acknowledgeWarning();
      } catch {
        try {
          const packageName = Application.applicationId;
          await IntentLauncher.startActivityAsync(
            "android.settings.APPLICATION_DETAILS_SETTINGS",
            {
              data: `package:${packageName}`,
            },
          );
          await acknowledgeWarning();
        } catch {
          try {
            await IntentLauncher.startActivityAsync(
              "android.settings.SETTINGS",
            );
            await acknowledgeWarning();
          } catch {
            Alert.alert(
              "Manual Steps Required",
              'Go to Settings > Apps > Novel DR\nTurn off "Pause app activity if unused" to keep your library from being removed.',
              [{ text: "OK", onPress: acknowledgeWarning }],
            );
          }
        }
      }
    } else if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    }
  };

  const openPanel = (panel: ActivePanel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));
  const closePanel = () => setActivePanel(null);

  const totalChapters = novels.reduce((sum, n) => sum + n.chapters.length, 0);
  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    Haptics.selectionAsync();
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerTitleContainer}>
          <Ionicons name="settings" size={22} color={colors.accent} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Settings
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowDevProfile(true);
          }}
        >
          <Ionicons name="beer-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {showWarningCard && Platform.OS === "android" && (
          <Pressable
            style={[
              styles.warningCard,
              { backgroundColor: colors.surface, borderColor: "#ffb300" },
            ]}
            onPress={openUnusedAppSettings}
            android_ripple={{ color: "#ffb30020" }}
          >
            <View style={styles.warningHeader}>
              <View style={styles.aboutRow}>
                <Ionicons name="warning" size={18} color="#ffb300" />
                <Text style={[styles.warningTitle, { color: colors.text }]}>
                  Protect Your Library
                </Text>
              </View>
            </View>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              Novel DR stores your entire library on this device only, with no
              cloud backup. If Android&apos;s{" "}
              <Text style={{ fontWeight: "700" }}>
                &apos;Remove unused apps&apos;
              </Text>{" "}
              feature uninstalls it after months of inactivity, your novels and
              chapters go with it. Turn off{" "}
              <Text style={{ fontWeight: "700" }}>
                &apos;Pause app activity if unused&apos;
              </Text>{" "}
              for Novel DR to prevent this.
            </Text>
            <Text style={[styles.warningTapHint, { color: "#ffb300" }]}>
              👆 Tap here to open settings
            </Text>
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          LIBRARY STATISTICS
        </Text>
        <View
          style={[
            styles.statsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.statItem}>
            <Ionicons name="library" size={20} color={colors.accent} />
            <View>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {novels.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                Novels
              </Text>
            </View>
          </View>
          <View
            style={[styles.statDivider, { backgroundColor: colors.border }]}
          />
          <View style={styles.statItem}>
            <Ionicons name="document-text" size={20} color={colors.accent} />
            <View>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {totalChapters.toLocaleString()}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                Chapters
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          APP THEME
        </Text>
        <View style={styles.themeRow}>
          <ThemeButton
            label="Dark"
            icon="moon"
            themeKey="dark"
            active={theme === "dark"}
            onPress={() => handleThemeChange("dark")}
          />
          <ThemeButton
            label="Light"
            icon="sunny"
            themeKey="light"
            active={theme === "light"}
            onPress={() => handleThemeChange("light")}
          />
          <ThemeButton
            label="Sepia"
            icon="book"
            themeKey="sepia"
            active={theme === "sepia"}
            onPress={() => handleThemeChange("sepia")}
          />
        </View>
        <View style={styles.themeRowSecond}>
          <ThemeButton
            label="AMOLED"
            icon="phone-portrait"
            themeKey="amoled"
            active={theme === "amoled"}
            onPress={() => handleThemeChange("amoled")}
          />
          <ThemeButton
            label="Warm"
            icon="cafe-outline"
            themeKey="warm"
            active={theme === "warm"}
            onPress={() => handleThemeChange("warm")}
          />
          <ThemeButton
            label="Slate"
            icon="cloudy-night-outline"
            themeKey="slate"
            active={theme === "slate"}
            onPress={() => handleThemeChange("slate")}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          BACKUP & RESTORE
        </Text>
        <View
          style={[
            styles.backupCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.backupDesc, { color: colors.textSecondary }]}>
            Creates a complete backup of all app data including novels,
            chapters, covers, reading progress, settings, and legacy
            AsyncStorage data. Everything is stored in a single file for easy
            sharing and restoration.
          </Text>

          {exporting && (
            <View style={styles.progressContainer}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text
                style={[styles.progressText, { color: colors.textSecondary }]}
              >
                {operationProgress || "Creating backup..."} ·{" "}
                {formatTimer(elapsedMs)}
              </Text>
            </View>
          )}

          {exporting && backupLogs.length > 0 && (
            <View
              style={[
                styles.backupActivityLog,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.backupActivityLogHeader}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Ionicons name="sync" size={14} color={colors.accent} />
                  <Text
                    style={[
                      styles.backupActivityLogTitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Activity Log
                  </Text>
                </View>
                <Pressable onPress={() => setBackupLogs([])}>
                  <Text
                    style={[styles.backupClearLog, { color: colors.textMuted }]}
                  >
                    Clear
                  </Text>
                </Pressable>
              </View>
              <FlatList
                data={backupLogs}
                keyExtractor={(_, index) => String(index)}
                renderItem={({ item }) => (
                  <Text
                    style={[
                      styles.backupActivityLogLine,
                      { color: colors.text },
                    ]}
                  >
                    {item}
                  </Text>
                )}
                style={styles.backupActivityLogScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator
                initialNumToRender={30}
                maxToRenderPerBatch={30}
                windowSize={5}
                removeClippedSubviews
              />
            </View>
          )}

          <View style={styles.backupRow}>
            <Pressable
              style={[
                styles.backupBtn,
                {
                  backgroundColor:
                    activePanel === "comment"
                      ? colors.accent + "dd"
                      : colors.accent,
                  opacity: exporting ? 0.6 : 1,
                },
              ]}
              onPress={handleExport}
              disabled={exporting || novels.length === 0}
            >
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={styles.backupBtnText}>
                {exporting ? "Backing up…" : "Backup All Data"}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.backupBtn,
                {
                  backgroundColor:
                    activePanel === "restore"
                      ? colors.accent + "18"
                      : colors.surface,
                  borderWidth: 1,
                  borderColor:
                    activePanel === "restore" ? colors.accent : colors.border,
                  opacity: importing ? 0.6 : 1,
                },
              ]}
              onPress={loadBackupList}
              disabled={importing}
            >
              <Ionicons
                name="folder-open-outline"
                size={18}
                color={colors.accent}
              />
              <Text style={[styles.backupBtnText, { color: colors.accent }]}>
                Restore Backup
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.backupBtn,
              {
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: importing ? 0.6 : 1,
              },
            ]}
            onPress={handleImportFromPicker}
            disabled={importing}
          >
            <Ionicons
              name="cloud-upload-outline"
              size={18}
              color={colors.accent}
            />
            <Text style={[styles.backupBtnText, { color: colors.accent }]}>
              Import from File
            </Text>
          </Pressable>

          {novels.length === 0 && (
            <Text style={[styles.backupHint, { color: colors.textMuted }]}>
              Add novels before creating a backup.
            </Text>
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          AUTO-BACKUP
        </Text>
        <View
          style={[
            styles.backupCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.autoBackupRow}>
            <View style={styles.autoBackupTextCol}>
              <Text style={[styles.autoBackupLabel, { color: colors.text }]}>
                Auto-Backup
              </Text>
              <Text
                style={[styles.backupDesc, { color: colors.textSecondary }]}
              >
                Backs up automatically when you close the app
              </Text>
            </View>
            <Switch
              value={autoBackupEnabled}
              onValueChange={handleToggleAutoBackup}
              trackColor={{ false: colors.surface, true: colors.accent }}
              thumbColor="#fff"
              ios_backgroundColor={colors.surface}
            />
          </View>
          {lastAutoBackupAt && (
            <Text
              style={[styles.autoBackupTimestamp, { color: colors.textMuted }]}
            >
              Last auto-backup: {formatAutoBackupTimestamp(lastAutoBackupAt)}
            </Text>
          )}
        </View>

        {/*
          Restore Backup — centered popup Modal
        */}
        <Modal
          visible={activePanel === "restore"}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!importing) closePanel();
          }}
        >
          <View style={styles.restoreModalOverlay}>
            <View
              style={[
                styles.restoreModalCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.backupListHeader}>
                <Text style={[styles.backupListTitle, { color: colors.text }]}>
                  {importing ? "Restoring…" : "Saved Backups"}
                </Text>
                <Pressable
                  onPress={closePanel}
                  disabled={importing}
                  hitSlop={8}
                >
                  <Ionicons
                    name="close"
                    size={20}
                    color={importing ? colors.textMuted : colors.textSecondary}
                  />
                </Pressable>
              </View>

              {importing ? (
                <>
                  <View style={styles.progressContainer}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text
                      style={[
                        styles.progressText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {operationProgress || "Restoring..."} ·{" "}
                      {formatTimer(elapsedMs)}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.backupActivityLog,
                      styles.restoreModalLog,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.backupActivityLogHeader}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons name="sync" size={14} color={colors.accent} />
                        <Text
                          style={[
                            styles.backupActivityLogTitle,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Activity Log
                        </Text>
                      </View>
                    </View>
                    <FlatList
                      data={backupLogs}
                      keyExtractor={(_, index) => String(index)}
                      renderItem={({ item }) => (
                        <Text
                          style={[
                            styles.backupActivityLogLine,
                            { color: colors.text },
                          ]}
                        >
                          {item}
                        </Text>
                      )}
                      style={styles.backupActivityLogScroll}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      initialNumToRender={30}
                      maxToRenderPerBatch={30}
                      windowSize={5}
                      removeClippedSubviews
                      onContentSizeChange={(_, h) => {
                        restoreLogListRef.current?.scrollToOffset({
                          offset: h,
                          animated: true,
                        });
                      }}
                      ref={restoreLogListRef}
                    />
                  </View>
                </>
              ) : backupList.length === 0 ? (
                <Text style={[styles.backupHint, { color: colors.textMuted }]}>
                  No backups found.
                </Text>
              ) : (
                <FlatList
                  data={backupList}
                  keyExtractor={(backup) => backup.name}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={7}
                  removeClippedSubviews
                  style={styles.restoreModalList}
                  renderItem={({ item: backup }) => {
                    const { date, time, tag } = parseFilename(backup.name);
                    return (
                      <Pressable
                        style={[
                          styles.backupItem,
                          { borderColor: colors.border },
                        ]}
                        onPress={() => handleImportBackup(backup.name)}
                      >
                        <View style={styles.backupItemInfo}>
                          <View style={styles.backupItemMeta}>
                            <Ionicons
                              name="time-outline"
                              size={13}
                              color={colors.textMuted}
                            />
                            <Text
                              style={[
                                styles.backupItemDate,
                                { color: colors.textSecondary },
                              ]}
                            >
                              {date} {time}
                            </Text>
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <Text
                              style={[
                                styles.backupItemTag,
                                { color: colors.text },
                              ]}
                            >
                              {tag || "No label"}
                            </Text>
                            {backup.format && (
                              <Text
                                style={[
                                  styles.backupItemStats,
                                  { color: colors.textMuted },
                                ]}
                              >
                                {BACKUP_FORMAT_LABELS[backup.format]}
                              </Text>
                            )}
                          </View>
                          {backup.metadata && (
                            <View style={{ gap: 2 }}>
                              <Text
                                style={[
                                  styles.backupItemStats,
                                  { color: colors.textMuted },
                                ]}
                              >
                                {backup.metadata.novelCount} novels •{" "}
                                {backup.metadata.totalChapters} chapters
                              </Text>
                              {backup.metadata.includesCovers && (
                                <Text
                                  style={[
                                    styles.backupItemStats,
                                    { color: colors.textMuted },
                                  ]}
                                >
                                  🖼️ Covers included •{" "}
                                  {(
                                    backup.metadata.totalCoverSize /
                                    (1024 * 1024)
                                  ).toFixed(2)}{" "}
                                  MB
                                </Text>
                              )}
                              {typeof backup.metadata.durationMs ===
                                "number" && (
                                <Text
                                  style={[
                                    styles.backupItemStats,
                                    { color: colors.textMuted },
                                  ]}
                                >
                                  ⏱️ Took{" "}
                                  {formatDuration(backup.metadata.durationMs)}{" "}
                                  to create
                                </Text>
                              )}
                            </View>
                          )}
                        </View>
                        <View style={styles.backupItemActions}>
                          <Pressable
                            onPress={async () => {
                              const canShare = await Sharing.isAvailableAsync();
                              const mimeType = backup.name.endsWith(".zip")
                                ? "application/zip"
                                : "application/json";
                              if (canShare)
                                await Sharing.shareAsync(
                                  BACKUP_DIR + backup.name,
                                  {
                                    mimeType,
                                    dialogTitle: "Share Backup",
                                  },
                                );
                            }}
                            style={styles.backupItemAction}
                          >
                            <Ionicons
                              name="share-outline"
                              size={18}
                              color={colors.accent}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => handleDeleteBackup(backup.name)}
                            style={styles.backupItemAction}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color="#FF4444"
                            />
                          </Pressable>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          </View>
        </Modal>

        {activePanel === "comment" && (
          <View
            style={[
              styles.commentCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.commentTitle, { color: colors.text }]}>
              Label this backup
            </Text>
            <Text style={[styles.commentSub, { color: colors.textSecondary }]}>
              Optional — helps identify this backup later
            </Text>
            <View style={styles.sizeEstimateRow}>
              <Ionicons
                name="server-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text
                style={[
                  styles.sizeEstimateText,
                  { color: colors.textSecondary },
                ]}
              >
                {estimatingSize
                  ? "Estimating size..."
                  : estimatedBackupSize !== null
                    ? `Estimated size: ~${(estimatedBackupSize / (1024 * 1024)).toFixed(1)} MB (before compression)`
                    : "Size estimate unavailable"}
              </Text>
            </View>
            <TextInput
              style={[
                styles.commentInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="e.g. full library backup"
              placeholderTextColor={colors.textMuted}
              value={pendingComment}
              onChangeText={setPendingComment}
              maxLength={40}
              autoFocus
            />
            <View style={styles.backupRow}>
              <Pressable
                style={[
                  styles.backupBtn,
                  {
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
                onPress={closePanel}
              >
                <Text
                  style={[
                    styles.backupBtnText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={[styles.backupBtn, { backgroundColor: colors.accent }]}
                onPress={() => confirmExport(pendingComment)}
              >
                <Ionicons name="save-outline" size={16} color="#fff" />
                <Text style={styles.backupBtnText}>Create Backup</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          ABOUT
        </Text>
        <View
          style={[
            styles.aboutCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.aboutRow}>
            <Ionicons name="globe" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>
              Download novels from popular supported sites. More sites coming
              soon.
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.aboutRow}>
            <Ionicons name="eye" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>
              Easy, Intuitive design & Feature-rich App.
            </Text>
          </View>
          <View style={styles.aboutRow}>
            <Ionicons name="bookmark" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>
              Tracks reading progress & where you left off.
            </Text>
          </View>
          <View style={styles.aboutRow}>
            <Ionicons name="cloud-offline" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>
              Download once, Read forever.
            </Text>
          </View>
        </View>

        <Pressable
          style={[
            styles.reportBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={() => setShowBugReport(true)}
        >
          <Ionicons name="bug-outline" size={18} color={colors.accent} />
          <Text style={[styles.reportBtnText, { color: colors.text }]}>
            Report Issue / Feedback
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.creditsBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={() => setShowCredits(true)}
        >
          <Ionicons name="heart-outline" size={18} color={colors.accent} />
          <Text style={[styles.creditsBtnText, { color: colors.text }]}>
            Credits & Acknowledgments
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.creditsBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={handleCheckForUpdates}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="cloud-download-outline"
              size={18}
              color={colors.accent}
            />
          )}
          <Text style={[styles.creditsBtnText, { color: colors.text }]}>
            {checkingUpdate ? "Checking..." : "Check for Updates"}
          </Text>
        </Pressable>

        <View
          style={[
            styles.versionCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.versionText, { color: colors.textMuted }]}>
            Novel DR — v{Constants.expoConfig?.version ?? "2.5.18"}
            {Application.nativeBuildVersion
              ? ` (build ${Application.nativeBuildVersion})`
              : ""}
          </Text>
          <Text style={[styles.madeByText, { color: colors.textMuted }]}>
            Made by Moggs ☕
          </Text>
        </View>
      </ScrollView>

      {/* Bug Report Modal */}
      <Modal visible={showBugReport} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.bugModalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.bugModalHeader}>
              <Text style={[styles.bugModalTitle, { color: colors.text }]}>
                Report an Issue
              </Text>
              <Pressable onPress={() => setShowBugReport(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.bugLabel, { color: colors.textSecondary }]}>
              Alias (optional)
            </Text>
            <TextInput
              style={[
                styles.bugInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="e.g. NovelReader123"
              placeholderTextColor={colors.textMuted}
              value={alias}
              onChangeText={setAlias}
            />
            <Text style={[styles.bugLabel, { color: colors.textSecondary }]}>
              What&apos;s the problem?
            </Text>
            <TextInput
              style={[
                styles.bugTextArea,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="Please describe the issue in detail..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={bugDescription}
              onChangeText={setBugDescription}
            />
            <View style={styles.bugButtonsRow}>
              <Pressable
                style={[
                  styles.bugCancelBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
                onPress={() => {
                  setShowBugReport(false);
                  setAlias("");
                  setBugDescription("");
                }}
              >
                <Text
                  style={[
                    styles.bugCancelText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={[styles.bugSendBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  if (!bugDescription.trim()) {
                    Alert.alert(
                      "Missing Info",
                      "Please describe the problem before sending.",
                    );
                    return;
                  }
                  const appVersion = Constants.expoConfig?.version ?? "2.5.18";
                  const emailSubject = encodeURIComponent(
                    `Bug Report from NovelDR (${alias || "Anonymous"})`,
                  );
                  const emailBody = encodeURIComponent(
                    `Alias: ${alias || "Anonymous"}\n\nDescription:\n${bugDescription}\n\n---\nApp Version: ${appVersion}\nDevice: ${Platform.OS} ${Platform.Version}`,
                  );
                  Linking.openURL(
                    `mailto:noveldrapp.concerns@gmail.com?subject=${emailSubject}&body=${emailBody}`,
                  ).catch(() => {
                    Alert.alert(
                      "Email Client Required",
                      "No email app found. Please send your report manually to: noveldrapp.concerns@gmail.com",
                    );
                  });
                  setShowBugReport(false);
                  setAlias("");
                  setBugDescription("");
                }}
              >
                <Ionicons name="send-outline" size={16} color="#fff" />
                <Text style={styles.bugSendText}>Send Report</Text>
              </Pressable>
            </View>
            <Text style={[styles.bugFooter, { color: colors.textMuted }]}>
              This will open your email app. Internet connection required.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Credits Modal */}
      <Modal visible={showCredits} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.creditsModalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.creditsModalHeader}>
              <Text style={[styles.creditsModalTitle, { color: colors.text }]}>
                Credits & Acknowledgments
              </Text>
              <Pressable onPress={() => setShowCredits(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.creditsScrollView}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[styles.creditsSectionTitle, { color: colors.accent }]}
              >
                🔍 Scraper Development
              </Text>
              <View
                style={[
                  styles.creditsItem,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.creditsItemName, { color: colors.text }]}>
                  Original Python Prototype
                </Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      "https://github.com/Moggle-Khraum/NovelDR-Python",
                    )
                  }
                >
                  <Text
                    style={[styles.creditsItemLink, { color: colors.accent }]}
                  >
                    @Moggle-Khraum/NovelDR-Python
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Rebuilt as ReactNative Mobile App from Python Source
                </Text>
                <Text style={[styles.creditsItemName, { color: colors.text }]}>
                  DeepSeek & Claude
                </Text>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Utilzed DeepSeek/Claude in building the useDirectScraper API
                  in ReactNative
                </Text>
              </View>
              <View
                style={[
                  styles.creditsItem,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.creditsItemName, { color: colors.text }]}>
                  WebNovel Source Scrapers
                </Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      "https://github.com/TUVIMEN/lightnovelworld",
                    )
                  }
                >
                  <Text
                    style={[styles.creditsItemLink, { color: colors.accent }]}
                  >
                    @TUVIMEN/lightnovelworld
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Forked LightNovelWorld Scraper into the App.
                </Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      "https://github.com/lncrawl/lightnovel-crawler/tree/dev",
                    )
                  }
                >
                  <Text
                    style={[styles.creditsItemLink, { color: colors.accent }]}
                  >
                    @lncrawl/lightnovel-crawler
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Adapted and ported 3 novel scraper src into the App.
                </Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      "https://github.com/Rudransh-Susarla-1802/Novel_Project",
                    )
                  }
                >
                  <Text
                    style={[styles.creditsItemLink, { color: colors.accent }]}
                  >
                    @Rudransh-Susarla-1802/Novel_Project
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Adapted and ported NovelArrow scraper to the App.
                </Text>
              </View>

              <Text
                style={[
                  styles.creditsSectionTitle,
                  { color: colors.accent, marginTop: 16 },
                ]}
              >
                🛠️ This App is Built with
              </Text>
              <View
                style={[
                  styles.creditsItem,
                  { borderBottomColor: colors.border },
                ]}
              >
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {[
                    { label: "Replit", url: "https://replit.com/" },
                    { label: "DeepSeek", url: "https://chat.deepseek.com/" },
                    { label: "Claude.ai", url: "https://claude.ai/new" },
                    { label: "Expo Dev", url: "https://expo.dev/" },
                    {
                      label: "Github Actions",
                      url: "https://github.com/Moggle-Khraum/NovelDR/actions",
                    },
                  ].map((item, i, arr) => (
                    <React.Fragment key={item.label}>
                      <Pressable onPress={() => Linking.openURL(item.url)}>
                        <Text
                          style={[
                            styles.creditsItemLink,
                            { color: colors.accent },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                      {i < arr.length - 1 && (
                        <Text style={{ color: colors.textSecondary }}>•</Text>
                      )}
                    </React.Fragment>
                  ))}
                </View>
              </View>
              <View
                style={[
                  styles.creditsItem,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.creditsItemName, { color: colors.text }]}>
                  Donors & Feedbacks
                </Text>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  - Furbiden
                </Text>
                <Text
                  style={[
                    styles.creditsItemDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  - ExTicketMan Reborn
                </Text>
              </View>
              <Text style={[styles.creditsFooter, { color: colors.textMuted }]}>
                Thank you to the sponsors, scraper authors, and AI that makes
                this app possible! 🙏
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Developer Profile Modal */}
      <Modal visible={showDevProfile} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.devCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.devTitleBar, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.devTitle, { color: colors.text }]}>
                About Developer
              </Text>
              <Pressable onPress={() => setShowDevProfile(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.devProfileRow}>
              <Image
                source={require("../../assets/images/icon.png")}
                style={[styles.devAppIcon, { borderColor: colors.border }]}
              />
              <View style={styles.devInfo}>
                <Text style={[styles.devLabel, { color: colors.textMuted }]}>
                  Name
                </Text>
                <Text style={[styles.devValue, { color: colors.text }]}>
                  Moggle Khraum
                </Text>
              </View>
            </View>

            <View
              style={[styles.devDivider, { backgroundColor: colors.border }]}
            />

            <View style={styles.devLinksRow}>
              <View style={styles.devLinkCol}>
                <Text
                  style={[
                    styles.devLinkColLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  Website:
                </Text>
                <Pressable
                  style={[
                    styles.devLinkBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                  onPress={() =>
                    Linking.openURL("https://moggle.is-a-good.dev/")
                  }
                >
                  <Ionicons
                    name="globe-outline"
                    size={15}
                    color={colors.accent}
                  />
                  <Text style={[styles.devLinkBtnText, { color: colors.text }]}>
                    NovelDR
                  </Text>
                </Pressable>
              </View>
              <View style={styles.devLinkCol}>
                <Text
                  style={[
                    styles.devLinkColLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  Github Release:
                </Text>
                <Pressable
                  style={[
                    styles.devLinkBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                  onPress={() =>
                    Linking.openURL(
                      "https://github.com/Moggle-Khraum/noveldr-site/releases",
                    )
                  }
                >
                  <Ionicons
                    name="logo-github"
                    size={15}
                    color={colors.accent}
                  />
                  <Text style={[styles.devLinkBtnText, { color: colors.text }]}>
                    Official Release
                  </Text>
                </Pressable>
              </View>
            </View>

            <View
              style={[styles.devFooterBox, { borderTopColor: colors.border }]}
            >
              <Text
                style={[styles.devIssueText, { color: colors.textSecondary }]}
              >
                For any suggestions/issues/bugs encountered, please use Github
                Issue or the Report Issue button.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  scroll: { padding: 16, gap: 12 },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
    marginTop: 8,
  },
  warningCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
    marginBottom: 4,
  },
  warningHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dismissButton: { padding: 4 },
  warningTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  warningText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  warningTapHint: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 6,
    textAlign: "center",
  },
  statsCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    padding: 20,
  },
  statItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 24 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  themeRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  themeRowSecond: { flexDirection: "row", gap: 10 },
  themeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  themeBtnLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  aboutCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  aboutRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  versionCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  versionText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  madeByText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 6,
    textAlign: "center",
  },
  backupCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  backupDesc: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 8,
  },
  progressText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  backupRow: { flexDirection: "row", gap: 8 },
  backupBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backupBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#fff",
  },
  backupHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
  },
  autoBackupRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  autoBackupTextCol: {
    flex: 1,
    paddingRight: 12,
    gap: 2,
  },
  autoBackupLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  autoBackupTimestamp: {
    fontFamily: "Inter_400Regular",
    fontSize: 11.5,
  },
  backupActivityLog: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    maxHeight: 200,
    minHeight: 100,
  },
  backupActivityLogHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  backupActivityLogTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  backupClearLog: { fontFamily: "Inter_500Medium", fontSize: 11 },
  backupActivityLogScroll: { maxHeight: 260 },
  backupActivityLogLine: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 3,
    paddingLeft: 4,
  },
  backupListCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  restoreModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  restoreModalCard: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "80%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  restoreModalList: {
    flexGrow: 0,
  },
  restoreModalLog: {
    flexGrow: 0,
    maxHeight: 320,
    minHeight: 180,
  },
  backupListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  backupListTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  backupItem: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  backupItemInfo: { flex: 1, gap: 3 },
  backupItemMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  backupItemDate: { fontFamily: "Inter_400Regular", fontSize: 12 },
  backupItemTag: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  backupItemStats: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  backupItemActions: { flexDirection: "row", gap: 4 },
  backupItemAction: { padding: 6 },
  commentCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  commentTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  commentSub: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  sizeEstimateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  sizeEstimateText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  devCard: {
    borderRadius: 14,
    borderWidth: 1,
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
  },
  devTitleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  devTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  devProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    paddingBottom: 14,
  },
  devAppIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
  },
  devInfo: { flexDirection: "column", gap: 2 },
  devLabel: { fontFamily: "Inter_500Medium", fontSize: 11, letterSpacing: 0.4 },
  devValue: { fontFamily: "Inter_700Bold", fontSize: 17 },
  devDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  devLinksRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  devLinkCol: { flex: 1, gap: 5 },
  devLinkColLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  devLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
  },
  devLinkBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  devFooterBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  devIssueText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  reportBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  creditsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  creditsBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  creditsModalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  creditsModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  creditsModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  creditsScrollView: { maxHeight: "90%" },
  creditsSectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    marginTop: 12,
    marginBottom: 8,
  },
  creditsItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  creditsItemName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  creditsItemLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textDecorationLine: "underline",
  },
  creditsItemDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  creditsFooter: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 8,
  },
  bugModalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
    width: "100%",
    maxWidth: 400,
  },
  bugModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  bugModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  bugLabel: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 4 },
  bugInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  bugTextArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    minHeight: 120,
  },
  bugButtonsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  bugCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  bugCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  bugSendBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  bugSendText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  bugFooter: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    marginTop: 8,
  },
});
