import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import Constants from 'expo-constants';
import * as DocumentPicker from "expo-document-picker";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import React, { useState, useEffect } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
  Linking,
  AppState,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";
import { Theme } from "@/constants/colors";

const imageToBase64 = async (imagePath: string): Promise<string | null> => {
  try {
    const info = await FileSystem.getInfoAsync(imagePath);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(imagePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.error('Failed to convert image to base64:', error);
    return null;
  }
};

const saveBase64AsImage = async (base64: string, targetPath: string): Promise<boolean> => {
  try {
    await FileSystem.writeAsStringAsync(targetPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return true;
  } catch (error) {
    console.error('Failed to save image from base64:', error);
    return false;
  }
};

function ThemeButton({
  label, icon, themeKey, active, onPress,
}: {
  label: string; icon: string; themeKey: Theme; active: boolean; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={[styles.themeBtn, {
        backgroundColor: active ? colors.accent : colors.surface,
        borderColor: active ? colors.accent : colors.border,
      }]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={18} color={active ? "#fff" : colors.textSecondary} />
      <Text style={[styles.themeBtnLabel, { color: active ? "#fff" : colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

type ActivePanel = "comment" | "restore" | null;

interface BackupMetadata {
  version: number;
  exportedAt: string;
  comment: string | null;
  novelCount: number;
  totalChapters: number;
  includesChapters: boolean;
  includesCovers: boolean;
  totalCoverSize: number;
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

export default function SettingsScreen() {
  const { colors, theme, setTheme } = useTheme();
  const { novels } = useLibrary();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupList, setBackupList] = useState<{ name: string; metadata: BackupMetadata | null }[]>([]);
  const [pendingComment, setPendingComment] = useState("");
  const [showDevProfile, setShowDevProfile] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [showWarningCard, setShowWarningCard] = useState(true);
  const [operationProgress, setOperationProgress] = useState("");
  const [backupLogs, setBackupLogs] = useState<string[]>([]);
  const [showBugReport, setShowBugReport] = useState(false);
  const [alias, setAlias] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [showCredits, setShowCredits] = useState(false);

  const APP_DATA_DIR = `${FileSystem.documentDirectory}NovelDR/`;
  const BACKUP_DIR = `${FileSystem.documentDirectory}noveldrr-backups/`;
  const SETTINGS_FILE = `${APP_DATA_DIR}settings.json`;
  const COVERS_DIR = `${FileSystem.documentDirectory}covers/`;

  const getAsyncStorage = async () => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return AsyncStorage;
    } catch { return null; }
  };

  const loadAppSettings = async (): Promise<Record<string, any>> => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
      if (!fileInfo.exists) return {};
      const content = await FileSystem.readAsStringAsync(SETTINGS_FILE);
      return JSON.parse(content);
    } catch { return {}; }
  };

  const saveAppSettings = async (settings: Record<string, any>) => {
    try {
      await ensureDir(APP_DATA_DIR);
      const current = await loadAppSettings();
      const updated = { ...current, ...settings };
      await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  useEffect(() => {
    const checkWarningStatus = async () => {
      try {
        const settings = await loadAppSettings();
        setShowWarningCard(settings.warningDismissed !== true);
      } catch (error) {
        console.error('Failed to check warning status:', error);
      }
    };
    checkWarningStatus();
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') checkWarningStatus();
    });
    return () => subscription.remove();
  }, []);

  const ensureDir = async (dirPath: string) => {
    const info = await FileSystem.getInfoAsync(dirPath);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  };

  const formatDateTag = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  };

  const readFileSafe = async (path: string): Promise<string | null> => {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(path);
    } catch { return null; }
  };

  const addBackupLog = (msg: string) => {
    setBackupLogs(prev => [...prev, msg]);
    setOperationProgress(msg);
  };

  const collectAppData = async (): Promise<FullBackup> => {
    setBackupLogs([]);
    addBackupLog("📂 Reading library data...");

    const libraryPath = `${APP_DATA_DIR}novel_library_v1.json`;
    const sortPath = `${APP_DATA_DIR}chapter_sort_preference.json`;
    const readerPath = `${APP_DATA_DIR}reader_settings.json`;

    let [libraryRaw, sortRaw, readerRaw, settingsData] = await Promise.all([
      readFileSafe(libraryPath),
      readFileSafe(sortPath),
      readFileSafe(readerPath),
      loadAppSettings(),
    ]);

    const AsyncStorage = await getAsyncStorage();
    if (AsyncStorage && !libraryRaw) {
      addBackupLog("📦 Checking legacy storage...");
      libraryRaw = await AsyncStorage.getItem('novel_library_v1');
      if (libraryRaw) addBackupLog("✅ Found legacy library data");
    }
    if (AsyncStorage && !sortRaw) sortRaw = await AsyncStorage.getItem('chapter_sort_preference');
    if (AsyncStorage && !readerRaw) {
      const fontSize = await AsyncStorage.getItem('reader_font_size_idx');
      const lineSpacing = await AsyncStorage.getItem('reader_line_spacing_idx');
      if (fontSize || lineSpacing) {
        readerRaw = JSON.stringify({
          fontSizeIdx: fontSize ? parseInt(fontSize) : 1,
          lineSpacingIdx: lineSpacing ? parseInt(lineSpacing) : 1,
        });
      }
    }

    const libraryData = libraryRaw ? JSON.parse(libraryRaw) : [];
    const novelCount = Array.isArray(libraryData) ? libraryData.length : 0;
    const sortPreference = sortRaw || "ascending";
    const readerSettings = readerRaw ? JSON.parse(readerRaw) : {};

    addBackupLog(`📚 Found ${novelCount} novels in library`);

    const chapters: Record<string, Record<string, any>> = {};
    const chaptersDir = `${APP_DATA_DIR}chapters/`;
    addBackupLog("🔍 Scanning chapter files...");

    try {
      const chaptersDirInfo = await FileSystem.getInfoAsync(chaptersDir);
      if (chaptersDirInfo.exists && chaptersDirInfo.isDirectory) {
        const novelDirs = await FileSystem.readDirectoryAsync(chaptersDir);
        addBackupLog(`📁 Found ${novelDirs.length} novel directories`);
        let totalChaptersFound = 0;
        for (const novelId of novelDirs) {
          const novelChapterDir = `${chaptersDir}${novelId}/`;
          const novelChapterInfo = await FileSystem.getInfoAsync(novelChapterDir);
          if (novelChapterInfo.exists && novelChapterInfo.isDirectory) {
            const chapterFiles = await FileSystem.readDirectoryAsync(novelChapterDir);
            const jsonFiles = chapterFiles.filter(f => f.startsWith('chapter_') && f.endsWith('.json'));
            if (jsonFiles.length > 0) {
              chapters[novelId] = {};
              for (const chapterFile of jsonFiles) {
                const chapterPath = `${novelChapterDir}${chapterFile}`;
                try {
                  const chapterRaw = await FileSystem.readAsStringAsync(chapterPath);
                  if (chapterRaw) {
                    const chapterData = JSON.parse(chapterRaw);
                    const chapterIndex = chapterFile.replace("chapter_", "").replace(".json", "");
                    chapters[novelId][chapterIndex] = chapterData;
                    totalChaptersFound++;
                  }
                } catch (err) {
                  addBackupLog(`⚠️ Skipped corrupted: ${chapterFile}`);
                }
              }
              const novelData = Array.isArray(libraryData) ? libraryData.find((n: any) => n.id === novelId) : null;
              const novelTitle = novelData?.title || novelId.slice(0, 12);
              addBackupLog(`   📄 ${novelTitle}: ${jsonFiles.length} chapters`);
            }
          }
        }
        addBackupLog(`📊 Total chapters found: ${totalChaptersFound}`);
      } else {
        addBackupLog("⚠️ No chapters folder found");
        if (AsyncStorage && Array.isArray(libraryData)) {
          addBackupLog("🔍 Checking AsyncStorage for chapter content...");
          let asyncChapterCount = 0;
          for (const novel of libraryData) {
            if (novel.chapters && Array.isArray(novel.chapters)) {
              const contentChapters = novel.chapters.filter((ch: any) => ch.content);
              if (contentChapters.length > 0) {
                chapters[novel.id] = {};
                for (let i = 0; i < novel.chapters.length; i++) {
                  if (novel.chapters[i].content) {
                    chapters[novel.id][i.toString()] = {
                      title: novel.chapters[i].title || `Chapter ${i + 1}`,
                      url: novel.chapters[i].url || '',
                      content: novel.chapters[i].content,
                    };
                    asyncChapterCount++;
                  }
                }
                addBackupLog(`   📄 ${novel.title}: ${contentChapters.length} chapters from legacy storage`);
              }
            }
          }
          if (asyncChapterCount > 0) addBackupLog(`📊 Total legacy chapters: ${asyncChapterCount}`);
        }
      }
    } catch (chaptersError) {
      addBackupLog(`❌ Error scanning chapters: ${String(chaptersError)}`);
    }

    const totalChapters = Object.values(chapters).reduce(
      (sum, novelChapters) => sum + Object.keys(novelChapters).length, 0
    );

    addBackupLog("🖼️ Scanning novel covers...");
    const covers: NovelCoverBackup[] = [];
    let totalCoverSize = 0;

    try {
      const coversDirInfo = await FileSystem.getInfoAsync(COVERS_DIR);
      if (coversDirInfo.exists && coversDirInfo.isDirectory) {
        const coverFiles = await FileSystem.readDirectoryAsync(COVERS_DIR);
        const imageFiles = coverFiles.filter(f =>
          f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp')
        );
        addBackupLog(`📁 Found ${imageFiles.length} cover images in covers/ directory`);
        for (const coverFile of imageFiles) {
          const coverPath = `${COVERS_DIR}${coverFile}`;
          const novelId = coverFile.replace(/\.(jpg|jpeg|png|webp)$/i, '');
          const novelExists = Array.isArray(libraryData) && libraryData.some((n: any) => n.id === novelId);
          if (novelExists) {
            const coverInfo = await FileSystem.getInfoAsync(coverPath);
            if (coverInfo.exists) {
              addBackupLog(`   🖼️ Converting cover: ${coverFile} (${((coverInfo.size || 0) / 1024).toFixed(1)} KB)`);
              const coverBase64 = await imageToBase64(coverPath);
              if (coverBase64) {
                covers.push({ novelId, coverBase64, fileName: coverFile });
                totalCoverSize += coverInfo.size || 0;
              } else {
                addBackupLog(`   ⚠️ Failed to convert cover: ${coverFile}`);
              }
            }
          } else {
            addBackupLog(`   ⏭️ Skipping orphan cover: ${coverFile}`);
          }
        }
        addBackupLog(`📊 Covers collected: ${covers.length} (${(totalCoverSize / (1024 * 1024)).toFixed(2)} MB total)`);
      } else {
        addBackupLog("⚠️ No covers directory found - no covers to backup");
      }

      if (covers.length === 0 && Array.isArray(libraryData)) {
        addBackupLog("🔄 Trying to fetch remote covers for novels without local files...");
        await ensureDir(COVERS_DIR);
        for (const novel of libraryData) {
          if (novel.coverUrl && novel.coverUrl.startsWith('http')) {
            try {
              const coverPath = `${COVERS_DIR}${novel.id}.jpg`;
              const result = await FileSystem.downloadAsync(novel.coverUrl, coverPath, {
                headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
              });
              const fileInfo = await FileSystem.getInfoAsync(result.uri);
              if (fileInfo.exists && (fileInfo as any).size > 1000) {
                const base64 = await imageToBase64(result.uri);
                if (base64) {
                  covers.push({ novelId: novel.id, coverBase64: base64, fileName: `${novel.id}.jpg` });
                  addBackupLog(`   ✅ Fetched remote cover: ${novel.title}`);
                }
              } else {
                addBackupLog(`   ⚠️ Cover too small or empty: ${novel.title}`);
              }
            } catch (e) {
              addBackupLog(`   ⚠️ Could not fetch cover for: ${novel.title}`);
            }
          }
        }
        if (covers.length > 0) addBackupLog(`📊 Fetched ${covers.length} remote covers as fallback`);
      }
    } catch (coversError) {
      addBackupLog(`❌ Error scanning covers: ${String(coversError)}`);
    }

    let asyncStorageData: Record<string, string> = {};
    if (AsyncStorage) {
      addBackupLog("📦 Saving legacy preferences...");
      try {
        const keys = [
          'novel_library_v1', 'chapter_sort_preference',
          'reader_font_size_idx', 'reader_line_spacing_idx', 'noveldr_warning_dismissed',
        ];
        for (const key of keys) {
          const value = await AsyncStorage.getItem(key);
          if (value !== null) asyncStorageData[key] = value;
        }
        addBackupLog("✅ Legacy preferences saved");
      } catch (e) {
        addBackupLog("⚠️ Could not read all legacy settings");
      }
    }

    addBackupLog(`✅ Backup ready: ${novelCount} novels, ${totalChapters} chapters, ${covers.length} covers`);

    return {
      metadata: {
        version: 4,
        exportedAt: new Date().toISOString(),
        comment: pendingComment.trim() || null,
        novelCount,
        totalChapters,
        includesChapters: totalChapters > 0,
        includesCovers: covers.length > 0,
        totalCoverSize,
      },
      libraryData,
      sortPreference,
      readerSettings,
      appSettings: settingsData,
      chapters,
      asyncStorageData,
      covers,
    };
  };

  const restoreAppData = async (backup: FullBackup) => {
    setBackupLogs([]);
    addBackupLog("🔄 Starting restore...");
    await ensureDir(APP_DATA_DIR);

    if (backup.libraryData) {
      addBackupLog("📚 Restoring library metadata...");
      await FileSystem.writeAsStringAsync(
        `${APP_DATA_DIR}novel_library_v1.json`,
        JSON.stringify(backup.libraryData)
      );
      const novelCount = Array.isArray(backup.libraryData) ? backup.libraryData.length : 0;
      addBackupLog(`✅ ${novelCount} novels restored`);
    }

    if (backup.sortPreference) {
      await FileSystem.writeAsStringAsync(
        `${APP_DATA_DIR}chapter_sort_preference.json`,
        JSON.stringify(backup.sortPreference)
      );
    }

    if (backup.readerSettings) {
      addBackupLog("⚙️ Restoring reader settings...");
      await FileSystem.writeAsStringAsync(
        `${APP_DATA_DIR}reader_settings.json`,
        JSON.stringify(backup.readerSettings)
      );
    }

    if (backup.appSettings) await saveAppSettings(backup.appSettings);

    if (backup.chapters && Object.keys(backup.chapters).length > 0) {
      const chaptersDir = `${APP_DATA_DIR}chapters/`;
      await ensureDir(chaptersDir);
      let totalChaptersRestored = 0;
      const novelIds = Object.keys(backup.chapters);
      addBackupLog(`📄 Restoring chapters for ${novelIds.length} novels...`);
      for (const novelId of novelIds) {
        const novelChapterDir = `${chaptersDir}${novelId}/`;
        await ensureDir(novelChapterDir);
        const novelChapters = backup.chapters[novelId];
        const chapterIndices = Object.keys(novelChapters);
        for (const chapterIndex of chapterIndices) {
          const chapterPath = `${novelChapterDir}chapter_${chapterIndex}.json`;
          try {
            await FileSystem.writeAsStringAsync(chapterPath, JSON.stringify(novelChapters[chapterIndex]));
            totalChaptersRestored++;
          } catch (err) {
            addBackupLog(`⚠️ Failed chapter ${chapterIndex}`);
          }
        }
        addBackupLog(`   ✅ Novel ${novelId.slice(0, 8)}...: ${chapterIndices.length} chapters`);
      }
      addBackupLog(`📊 Total chapters restored: ${totalChaptersRestored}`);
    } else {
      addBackupLog("⚠️ No chapters to restore");
    }

    if (backup.covers && backup.covers.length > 0) {
      addBackupLog(`🖼️ Restoring ${backup.covers.length} novel covers...`);
      await ensureDir(COVERS_DIR);
      let coversRestored = 0, coversFailed = 0;
      for (const cover of backup.covers) {
        if (cover.coverBase64) {
          const coverPath = `${COVERS_DIR}${cover.fileName}`;
          const success = await saveBase64AsImage(cover.coverBase64, coverPath);
          if (success) { coversRestored++; addBackupLog(`   ✅ ${cover.fileName}`); }
          else { coversFailed++; addBackupLog(`   ❌ Failed: ${cover.fileName}`); }
        } else {
          coversFailed++;
          addBackupLog(`   ⚠️ No image data for ${cover.fileName}`);
        }
      }
      addBackupLog(`📊 Covers restored: ${coversRestored} ✅, ${coversFailed} ❌`);
      addBackupLog(`🔄 Updating novel cover references...`);
      if (backup.libraryData && Array.isArray(backup.libraryData)) {
        for (const novel of backup.libraryData) {
          const matchingCover = backup.covers.find(c => c.novelId === novel.id);
          if (matchingCover) novel.coverUrl = `${COVERS_DIR}${matchingCover.fileName}`;
        }
        await FileSystem.writeAsStringAsync(
          `${APP_DATA_DIR}novel_library_v1.json`,
          JSON.stringify(backup.libraryData)
        );
        addBackupLog(`✅ Novel cover references updated`);
      }
      if (backup.metadata.totalCoverSize) {
        addBackupLog(`💾 Total cover size: ${(backup.metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB`);
      }
    } else {
      addBackupLog("⚠️ No covers to restore");
    }

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

    addBackupLog("✅ Restore complete!");
  };

  const handleExport = () => {
    if (novels.length === 0) return;
    setPendingComment("");
    setBackupLogs([]);
    openPanel("comment");
  };

  const confirmExport = async (comment: string) => {
    try {
      closePanel();
      setExporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const backup = await collectAppData();
      addBackupLog("💾 Saving backup file...");
      await ensureDir(BACKUP_DIR);
      const dateTag = formatDateTag();
      const tag = comment.trim().replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const filename = `noveldrr-backup-${dateTag}${tag ? "_" + tag : ""}.json`;
      const backupPath = `${BACKUP_DIR}${filename}`;
      await FileSystem.writeAsStringAsync(backupPath, JSON.stringify(backup, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      const fileInfo = await FileSystem.getInfoAsync(backupPath);
      const sizeMB = fileInfo.exists ? ((fileInfo.size || 0) / (1024 * 1024)).toFixed(1) : "0";
      addBackupLog(`✅ Backup saved: ${filename} (${sizeMB} MB)`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      let coverInfo = "";
      if (backup.metadata.includesCovers) {
        coverInfo = `\n🖼️ ${backup.covers.length} covers (${(backup.metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB)`;
      }
      Alert.alert(
        "Backup Complete ✓",
        `Saved to: ${filename}\n\n📚 ${backup.metadata.novelCount} novels\n📄 ${backup.metadata.totalChapters} chapters${coverInfo}\n💾 ${sizeMB} MB\n\nAll data backed up including covers and legacy AsyncStorage content.`,
        [
          { text: "OK" },
          {
            text: "Share Backup",
            onPress: async () => {
              const canShare = await Sharing.isAvailableAsync();
              if (canShare) await Sharing.shareAsync(backupPath, { mimeType: "application/json", dialogTitle: "Share NovelDR Backup" });
            },
          },
        ]
      );
    } catch (e) {
      addBackupLog(`❌ Export failed: ${String(e)}`);
      Alert.alert("Export Failed", String(e));
    } finally {
      setExporting(false);
    }
  };

  const loadBackupList = async () => {
    try {
      await ensureDir(BACKUP_DIR);
      const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
      const jsonBackups = files
        .filter(f => f.startsWith("noveldrr-backup-") && f.endsWith(".json"))
        .sort().reverse();
      const backupsWithMeta = await Promise.all(
        jsonBackups.map(async (filename) => {
          const path = `${BACKUP_DIR}${filename}`;
          try {
            const raw = await FileSystem.readAsStringAsync(path);
            const backup = JSON.parse(raw);
            return { name: filename, metadata: backup.metadata || null };
          } catch {
            return { name: filename, metadata: null };
          }
        })
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
    try {
      const rawPreview = await FileSystem.readAsStringAsync(backupPath);
      const preview = JSON.parse(rawPreview);
      if (preview.metadata?.includesCovers) {
        coverInfo = `\n🖼️ Includes ${preview.covers?.length || 0} novel covers (${(preview.metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB)`;
      }
    } catch (e) {}

    Alert.alert(
      "Restore Backup",
      `This will replace ALL current data with the backup.\n\n"${filename}"${coverInfo}\n\n⚠️ Current data will be overwritten. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            try {
              setImporting(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const raw = await FileSystem.readAsStringAsync(backupPath);
              const backup: FullBackup = JSON.parse(raw);
              if (!backup.metadata || !backup.libraryData) {
                Alert.alert("Invalid Backup", "This file is not a valid NovelDR backup.");
                return;
              }
              await restoreAppData(backup);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                "Restore Complete ✓",
                `Successfully restored:\n\n📚 ${backup.metadata.novelCount} novels\n📄 ${backup.metadata.totalChapters} chapters\n` +
                (backup.metadata.includesCovers ? `🖼️ ${backup.covers?.length || 0} covers\n` : "") +
                (backup.asyncStorageData ? `🔄 Legacy data also restored\n\n` : "\n") +
                `Please refresh the Library by pulling or pressing the refresh button.`,
                [{
                  text: "OK",
                  onPress: () => {
                    if (Platform.OS === 'android') IntentLauncher.startActivityAsync('android.intent.action.MAIN');
                  }
                }]
              );
              closePanel();
            } catch (e) {
              Alert.alert("Import Failed", String(e));
            } finally {
              setImporting(false);
            }
          },
        },
      ]
    );
  };

  const handleImportFromPicker = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
      if (result.canceled) return;
      Alert.alert(
        "Restore Backup",
        "This will replace ALL current data with the selected backup.\n\n⚠️ Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            style: "destructive",
            onPress: async () => {
              try {
                setImporting(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const raw = await FileSystem.readAsStringAsync(result.assets[0].uri);
                const backup: FullBackup = JSON.parse(raw);
                if (!backup.metadata || !backup.libraryData) {
                  Alert.alert("Invalid Backup", "This file is not a valid NovelDR backup.");
                  return;
                }
                await restoreAppData(backup);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert("Restore Complete ✓", "Data restored. Please restart the app.", [{ text: "OK" }]);
              } catch (e) {
                Alert.alert("Import Failed", String(e));
              } finally {
                setImporting(false);
              }
            },
          },
        ]
      );
    } catch (e) {
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
          await FileSystem.deleteAsync(BACKUP_DIR + filename, { idempotent: true });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setBackupList(prev => prev.filter(b => b.name !== filename));
        },
      },
    ]);
  };

  const parseFilename = (filename: string) => {
    const base = filename.replace("noveldrr-backup-", "").replace(".json", "");
    const [datePart, timePart, ...rest] = base.split("_");
    const date = datePart ?? "";
    const time = timePart ? timePart.replace(/-/g, ":") : "";
    const tag = rest.join(" ").replace(/-/g, " ") || null;
    return { date, time, tag };
  };

  const openUnusedAppSettings = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNUSED_APPS');
        await saveAppSettings({ warningDismissed: true });
        setShowWarningCard(false);
      } catch (error) {
        try {
          const packageName = Application.applicationId;
          await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', { data: `package:${packageName}` });
          await saveAppSettings({ warningDismissed: true });
          setShowWarningCard(false);
        } catch (e) {
          try {
            await IntentLauncher.startActivityAsync('android.settings.SETTINGS');
            await saveAppSettings({ warningDismissed: true });
            setShowWarningCard(false);
          } catch (finalError) {
            Alert.alert(
              'Manual Steps Required',
              'Go to Settings > Apps > Novel DR\nTurn off: Pause app activity if unused & Remove permissions',
              [{ text: 'OK', onPress: async () => { await saveAppSettings({ warningDismissed: true }); setShowWarningCard(false); } }]
            );
          }
        }
      }
    } else if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    }
  };

  const dismissWarning = async () => {
    await saveAppSettings({ warningDismissed: true });
    setShowWarningCard(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const openPanel = (panel: ActivePanel) => setActivePanel(prev => prev === panel ? null : panel);
  const closePanel = () => setActivePanel(null);

  const totalChapters = novels.reduce((sum, n) => sum + n.chapters.length, 0);
  const handleThemeChange = (t: Theme) => { setTheme(t); Haptics.selectionAsync(); };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="settings" size={22} color={colors.accent} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        </View>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowDevProfile(true); }}>
          <Ionicons name="beer-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 100 }]} showsVerticalScrollIndicator={false}>
        {showWarningCard && Platform.OS === 'android' && (
          <Pressable
            style={[styles.warningCard, { backgroundColor: colors.surface, borderColor: "#ffb300" }]}
            onPress={openUnusedAppSettings}
            android_ripple={{ color: '#ffb30020' }}
          >
            <View style={styles.warningHeader}>
              <View style={styles.aboutRow}>
                <Ionicons name="warning" size={18} color="#ffb300" />
                <Text style={[styles.warningTitle, { color: colors.text }]}>System Action Required</Text>
              </View>
              <Pressable onPress={dismissWarning} style={styles.dismissButton}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              Turn off <Text style={{ fontWeight: '700' }}>'Manage unused Apps'</Text> and{' '}
              <Text style={{ fontWeight: '700' }}>'Remove permissions and free up space'</Text>{' '}
              to prevent data loss.
            </Text>
            <Text style={[styles.warningTapHint, { color: '#ffb300' }]}>👆 Tap here to open settings</Text>
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>LIBRARY STATISTICS</Text>
        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Ionicons name="library" size={20} color={colors.accent} />
            <View>
              <Text style={[styles.statValue, { color: colors.text }]}>{novels.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Novels</Text>
            </View>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Ionicons name="document-text" size={20} color={colors.accent} />
            <View>
              <Text style={[styles.statValue, { color: colors.text }]}>{totalChapters.toLocaleString()}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Chapters</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>APP THEME</Text>
        <View style={styles.themeRow}>
          <ThemeButton label="Dark" icon="moon" themeKey="dark" active={theme === "dark"} onPress={() => handleThemeChange("dark")} />
          <ThemeButton label="Light" icon="sunny" themeKey="light" active={theme === "light"} onPress={() => handleThemeChange("light")} />
          <ThemeButton label="Sepia" icon="book" themeKey="sepia" active={theme === "sepia"} onPress={() => handleThemeChange("sepia")} />
        </View>
        <View style={styles.themeRowSecond}>
          <ThemeButton label="AMOLED" icon="phone-portrait" themeKey="amoled" active={theme === "amoled"} onPress={() => handleThemeChange("amoled")} />
          <ThemeButton label="Warm" icon="cafe-outline" themeKey="warm" active={theme === "warm"} onPress={() => handleThemeChange("warm")} />
          <ThemeButton label="Slate" icon="cloudy-night-outline" themeKey="slate" active={theme === "slate"} onPress={() => handleThemeChange("slate")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>BACKUP & RESTORE</Text>
        <View style={[styles.backupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.backupDesc, { color: colors.textSecondary }]}>
            Creates a complete backup of all app data including novels, chapters, covers, reading progress, settings, and legacy
            AsyncStorage data. Everything is stored in a single file for easy sharing and restoration.
          </Text>

          {(exporting || importing) && (
            <View style={styles.progressContainer}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                {operationProgress || (exporting ? "Creating backup..." : "Restoring...")}
              </Text>
            </View>
          )}

          {backupLogs.length > 0 && (
            <View style={[styles.backupActivityLog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.backupActivityLogHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="sync" size={14} color={colors.accent} />
                  <Text style={[styles.backupActivityLogTitle, { color: colors.textSecondary }]}>Activity Log</Text>
                </View>
                <Pressable onPress={() => setBackupLogs([])}>
                  <Text style={[styles.backupClearLog, { color: colors.textMuted }]}>Clear</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.backupActivityLogScroll} nestedScrollEnabled showsVerticalScrollIndicator>
                {backupLogs.map((log, index) => (
                  <Text key={index} style={[styles.backupActivityLogLine, { color: colors.text }]}>{log}</Text>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.backupRow}>
            <Pressable
              style={[styles.backupBtn, { backgroundColor: activePanel === "comment" ? colors.accent + "dd" : colors.accent, opacity: exporting ? 0.6 : 1 }]}
              onPress={handleExport}
              disabled={exporting || novels.length === 0}
            >
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={styles.backupBtnText}>{exporting ? "Backing up…" : "Backup All Data"}</Text>
            </Pressable>
            <Pressable
              style={[styles.backupBtn, { backgroundColor: activePanel === "restore" ? colors.accent + "18" : colors.surface, borderWidth: 1, borderColor: activePanel === "restore" ? colors.accent : colors.border, opacity: importing ? 0.6 : 1 }]}
              onPress={loadBackupList}
              disabled={importing}
            >
              <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
              <Text style={[styles.backupBtnText, { color: colors.accent }]}>Restore Backup</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.backupBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: importing ? 0.6 : 1 }]}
            onPress={handleImportFromPicker}
            disabled={importing}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={colors.accent} />
            <Text style={[styles.backupBtnText, { color: colors.accent }]}>Import from File</Text>
          </Pressable>

          {novels.length === 0 && (
            <Text style={[styles.backupHint, { color: colors.textMuted }]}>Add novels before creating a backup.</Text>
          )}
        </View>

        {activePanel === "restore" && (
          <View style={[styles.backupListCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.backupListHeader}>
              <Text style={[styles.backupListTitle, { color: colors.text }]}>Saved Backups</Text>
              <Pressable onPress={closePanel}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            {backupList.length === 0 ? (
              <Text style={[styles.backupHint, { color: colors.textMuted }]}>No backups found.</Text>
            ) : (
              backupList.map((backup) => {
                const { date, time, tag } = parseFilename(backup.name);
                return (
                  <Pressable
                    key={backup.name}
                    style={[styles.backupItem, { borderColor: colors.border }]}
                    onPress={() => handleImportBackup(backup.name)}
                  >
                    <View style={styles.backupItemInfo}>
                      <View style={styles.backupItemMeta}>
                        <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                        <Text style={[styles.backupItemDate, { color: colors.textSecondary }]}>{date} {time}</Text>
                      </View>
                      <Text style={[styles.backupItemTag, { color: colors.text }]}>{tag || "No label"}</Text>
                      {backup.metadata && (
                        <View style={{ gap: 2 }}>
                          <Text style={[styles.backupItemStats, { color: colors.textMuted }]}>
                            {backup.metadata.novelCount} novels • {backup.metadata.totalChapters} chapters
                          </Text>
                          {backup.metadata.includesCovers && (
                            <Text style={[styles.backupItemStats, { color: colors.textMuted }]}>
                              🖼️ Covers included • {(backup.metadata.totalCoverSize / (1024 * 1024)).toFixed(2)} MB
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                    <View style={styles.backupItemActions}>
                      <Pressable
                        onPress={async () => {
                          const canShare = await Sharing.isAvailableAsync();
                          if (canShare) await Sharing.shareAsync(BACKUP_DIR + backup.name, { mimeType: "application/json", dialogTitle: "Share Backup" });
                        }}
                        style={styles.backupItemAction}
                      >
                        <Ionicons name="share-outline" size={18} color={colors.accent} />
                      </Pressable>
                      <Pressable onPress={() => handleDeleteBackup(backup.name)} style={styles.backupItemAction}>
                        <Ionicons name="trash-outline" size={18} color="#FF4444" />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {activePanel === "comment" && (
          <View style={[styles.commentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.commentTitle, { color: colors.text }]}>Label this backup</Text>
            <Text style={[styles.commentSub, { color: colors.textSecondary }]}>Optional — helps identify this backup later</Text>
            <TextInput
              style={[styles.commentInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. full library backup"
              placeholderTextColor={colors.textMuted}
              value={pendingComment}
              onChangeText={setPendingComment}
              maxLength={40}
              autoFocus
            />
            <View style={styles.backupRow}>
              <Pressable
                style={[styles.backupBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                onPress={closePanel}
              >
                <Text style={[styles.backupBtnText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.backupBtn, { backgroundColor: colors.accent }]} onPress={() => confirmExport(pendingComment)}>
                <Ionicons name="save-outline" size={16} color="#fff" />
                <Text style={styles.backupBtnText}>Create Backup</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ABOUT</Text>
        <View style={[styles.aboutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.aboutRow}>
            <Ionicons name="globe" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>Download novels from popular supported sites. More sites coming soon.</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.aboutRow}>
            <Ionicons name="eye" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>Easy, Intuitive design & Feature-rich App.</Text>
          </View>
          <View style={styles.aboutRow}>
            <Ionicons name="bookmark" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>Tracks reading progress & where you left off.</Text>
          </View>
          <View style={styles.aboutRow}>
            <Ionicons name="cloud-offline" size={16} color={colors.accent} />
            <Text style={[styles.aboutText, { color: colors.text }]}>Download once, Read forever.</Text>
          </View>
        </View>

        <Pressable
          style={[styles.reportBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={() => setShowBugReport(true)}
        >
          <Ionicons name="bug-outline" size={18} color={colors.accent} />
          <Text style={[styles.reportBtnText, { color: colors.text }]}>Report Issue / Feedback</Text>
        </Pressable>

        <Pressable
          style={[styles.creditsBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={() => setShowCredits(true)}
        >
          <Ionicons name="heart-outline" size={18} color={colors.accent} />
          <Text style={[styles.creditsBtnText, { color: colors.text }]}>Credits & Acknowledgments</Text>
        </Pressable>

        <View style={[styles.versionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.versionText, { color: colors.textMuted }]}>
            Novel DR — v{Constants.expoConfig?.version ?? "2.5.18"}
            {Application.nativeBuildVersion ? ` (build ${Application.nativeBuildVersion})` : ""}
          </Text>
          <Text style={[styles.madeByText, { color: colors.textMuted }]}>Made by Moggs ☕</Text>
        </View>
      </ScrollView>

      {/* Bug Report Modal */}
      <Modal visible={showBugReport} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.bugModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.bugModalHeader}>
              <Text style={[styles.bugModalTitle, { color: colors.text }]}>Report an Issue</Text>
              <Pressable onPress={() => setShowBugReport(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.bugLabel, { color: colors.textSecondary }]}>Alias (optional)</Text>
            <TextInput
              style={[styles.bugInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. NovelReader123"
              placeholderTextColor={colors.textMuted}
              value={alias}
              onChangeText={setAlias}
            />
            <Text style={[styles.bugLabel, { color: colors.textSecondary }]}>What's the problem?</Text>
            <TextInput
              style={[styles.bugTextArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
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
                style={[styles.bugCancelBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => { setShowBugReport(false); setAlias(""); setBugDescription(""); }}
              >
                <Text style={[styles.bugCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.bugSendBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  if (!bugDescription.trim()) {
                    Alert.alert("Missing Info", "Please describe the problem before sending.");
                    return;
                  }
                  const appVersion = Constants.expoConfig?.version ?? "2.5.18";
                  const emailSubject = encodeURIComponent(`Bug Report from NovelDR (${alias || "Anonymous"})`);
                  const emailBody = encodeURIComponent(
                    `Alias: ${alias || "Anonymous"}\n\nDescription:\n${bugDescription}\n\n---\nApp Version: ${appVersion}\nDevice: ${Platform.OS} ${Platform.Version}`
                  );
                  Linking.openURL(`mailto:noveldrapp.concerns@gmail.com?subject=${emailSubject}&body=${emailBody}`).catch(() => {
                    Alert.alert("Email Client Required", "No email app found. Please send your report manually to: noveldrapp.concerns@gmail.com");
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
          <View style={[styles.creditsModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.creditsModalHeader}>
              <Text style={[styles.creditsModalTitle, { color: colors.text }]}>Credits & Acknowledgments</Text>
              <Pressable onPress={() => setShowCredits(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={styles.creditsScrollView} showsVerticalScrollIndicator={false}>
              <Text style={[styles.creditsSectionTitle, { color: colors.accent }]}>🔍 Scraper Development</Text>
              <View style={[styles.creditsItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.creditsItemName, { color: colors.text }]}>Original Python Prototype</Text>
                <Pressable onPress={() => Linking.openURL("https://github.com/Moggle-Khraum/NovelDR-Python")}>
                  <Text style={[styles.creditsItemLink, { color: colors.accent }]}>@Moggle-Khraum/NovelDR-Python</Text>
                </Pressable>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>
                  Rebuilt as ReactNative Mobile App from Python Source
                </Text>
                <Text style={[styles.creditsItemName, { color: colors.text }]}>DeepSeek & Claude</Text>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>
                  Utilzed DeepSeek/Claude in building the useDirectScraper API in ReactNative
                </Text>
              </View>
              <View style={[styles.creditsItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.creditsItemName, { color: colors.text }]}>WebNovel Source Scrapers</Text>
                <Pressable onPress={() => Linking.openURL("https://github.com/TUVIMEN/lightnovelworld")}>
                  <Text style={[styles.creditsItemLink, { color: colors.accent }]}>@TUVIMEN/lightnovelworld</Text>
                </Pressable>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>
                  Forked LightNovelWorld Scraper into the App.
                </Text>
                <Pressable onPress={() => Linking.openURL("https://github.com/lncrawl/lightnovel-crawler/tree/dev")}>
                  <Text style={[styles.creditsItemLink, { color: colors.accent }]}>@lncrawl/lightnovel-crawler</Text>
                </Pressable>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>
                  Adapted and ported 3 novel scraper src into the App.
                </Text>
              </View>

              <Text style={[styles.creditsSectionTitle, { color: colors.accent, marginTop: 16 }]}>🛠️ This App is Built with</Text>
              <View style={[styles.creditsItem, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    { label: "Replit", url: "https://replit.com/" },
                    { label: "DeepSeek", url: "https://chat.deepseek.com/" },
                    { label: "Claude.ai", url: "https://claude.ai/new" },
                    { label: "Expo Dev", url: "https://expo.dev/" },
                    { label: "Github Actions", url: "https://github.com/Moggle-Khraum/NovelDR/actions" },
                  ].map((item, i, arr) => (
                    <React.Fragment key={item.label}>
                      <Pressable onPress={() => Linking.openURL(item.url)}>
                        <Text style={[styles.creditsItemLink, { color: colors.accent }]}>{item.label}</Text>
                      </Pressable>
                      {i < arr.length - 1 && <Text style={{ color: colors.textSecondary }}>•</Text>}
                    </React.Fragment>
                  ))}
                </View>
              </View>
              <View style={[styles.creditsItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.creditsItemName, { color: colors.text }]}>Donors & Feedbacks</Text>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>- Furbiden</Text>
                <Text style={[styles.creditsItemDesc, { color: colors.textSecondary }]}>- ExTicketMan Reborn</Text>
              </View>
              <Text style={[styles.creditsFooter, { color: colors.textMuted }]}>
                Thank you to the sponsors, scraper authors, and AI that makes this app possible! 🙏
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Developer Profile Modal */}
      <Modal visible={showDevProfile} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.devCard, { backgroundColor: colors.card, borderColor: colors.border }]}>

            {/* Title bar */}
            <View style={[styles.devTitleBar, { borderBottomColor: colors.border }]}>
              <Text style={[styles.devTitle, { color: colors.text }]}>About Developer</Text>
              <Pressable onPress={() => setShowDevProfile(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* App icon + name row */}
            <View style={styles.devProfileRow}>
              <Image
                source={require("../../assets/images/icon.png")}
                style={[styles.devAppIcon, { borderColor: colors.border }]}
              />
              <View style={styles.devInfo}>
                <Text style={[styles.devLabel, { color: colors.textMuted }]}>Name</Text>
                <Text style={[styles.devValue, { color: colors.text }]}>Moggle Khraum</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={[styles.devDivider, { backgroundColor: colors.border }]} />

            {/* Side-by-side link buttons with labels above */}
            <View style={styles.devLinksRow}>
              <View style={styles.devLinkCol}>
                <Text style={[styles.devLinkColLabel, { color: colors.textSecondary }]}>Website:</Text>
                <Pressable
                  style={[styles.devLinkBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => Linking.openURL("https://moggle.is-a-good.dev/")}
                >
                  <Ionicons name="globe-outline" size={15} color={colors.accent} />
                  <Text style={[styles.devLinkBtnText, { color: colors.text }]}>NovelDR</Text>
                </Pressable>
              </View>
              <View style={styles.devLinkCol}>
                <Text style={[styles.devLinkColLabel, { color: colors.textSecondary }]}>Github Release:</Text>
                <Pressable
                  style={[styles.devLinkBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => Linking.openURL("https://github.com/Moggle-Khraum/noveldr-site/releases")}
                >
                  <Ionicons name="logo-github" size={15} color={colors.accent} />
                  <Text style={[styles.devLinkBtnText, { color: colors.text }]}>Official Release</Text>
                </Pressable>
              </View>
            </View>

            {/* Footer note */}
            <View style={[styles.devFooterBox, { borderTopColor: colors.border }]}>
              <Text style={[styles.devIssueText, { color: colors.textSecondary }]}>
                For any suggestions/issues/bugs encountered, please use Github Issue or the Report Issue button.
              </Text>
            </View>

          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  scroll: { padding: 16, gap: 12 },
  sectionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.8, marginTop: 8 },
  warningCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 6, marginBottom: 4 },
  warningHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dismissButton: { padding: 4 },
  warningTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  warningText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  warningTapHint: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 6, textAlign: 'center' },
  statsCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", padding: 20 },
  statItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 24 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  themeRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  themeRowSecond: { flexDirection: "row", gap: 10 },
  themeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  themeBtnLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  aboutCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  aboutRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  versionCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, alignItems: "center", marginTop: 4 },
  versionText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  madeByText: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 6, textAlign: "center" },
  backupCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  backupDesc: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  progressContainer: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8,
  },
  progressText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  backupRow: { flexDirection: "row", gap: 8 },
  backupBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 12,
  },
  backupBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  backupHint: { fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center" },
  backupActivityLog: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 10, maxHeight: 200, minHeight: 100 },
  backupActivityLogHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0',
  },
  backupActivityLogTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.5 },
  backupClearLog: { fontFamily: "Inter_500Medium", fontSize: 11 },
  backupActivityLogScroll: { maxHeight: 150 },
  backupActivityLogLine: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginBottom: 3, paddingLeft: 4 },
  backupListCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  backupListHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  backupListTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  backupItem: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingBottom: 4, gap: 8 },
  backupItemInfo: { flex: 1, gap: 3 },
  backupItemMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  backupItemDate: { fontFamily: "Inter_400Regular", fontSize: 12 },
  backupItemTag: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  backupItemStats: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  backupItemActions: { flexDirection: "row", gap: 4 },
  backupItemAction: { padding: 6 },
  commentCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  commentTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  commentSub: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  commentInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: "Inter_400Regular", fontSize: 14,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  // Dev modal
  devCard: { borderRadius: 14, borderWidth: 1, width: '100%', maxWidth: 360, overflow: "hidden" },
  devTitleBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  devTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  devProfileRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, paddingBottom: 14 },
  devAppIcon: { width: 54, height: 54, borderRadius: 27, borderWidth: StyleSheet.hairlineWidth },
  devInfo: { flexDirection: "column", gap: 2 },
  devLabel: { fontFamily: "Inter_500Medium", fontSize: 11, letterSpacing: 0.4 },
  devValue: { fontFamily: "Inter_700Bold", fontSize: 17 },
  devDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  devLinksRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  devLinkCol: { flex: 1, gap: 5 },
  devLinkColLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  devLinkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 8,
  },
  devLinkBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  devFooterBox: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12 },
  devIssueText: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, textAlign: "center" },
  // Bug report
  reportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  reportBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  // Credits
  creditsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  creditsBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  creditsModalCard: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 12, width: '100%', maxWidth: 400, maxHeight: '80%' },
  creditsModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  creditsModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  creditsScrollView: { maxHeight: '90%' },
  creditsSectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, marginTop: 12, marginBottom: 8 },
  creditsItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  creditsItemName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  creditsItemLink: { fontFamily: "Inter_500Medium", fontSize: 12, textDecorationLine: "underline" },
  creditsItemDesc: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  creditsFooter: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", marginTop: 16, marginBottom: 8 },
  // Bug report modal
  bugModalCard: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 12, width: '100%', maxWidth: 400 },
  bugModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  bugModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  bugLabel: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 4 },
  bugInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontFamily: "Inter_400Regular", fontSize: 14 },
  bugTextArea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 120 },
  bugButtonsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  bugCancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  bugCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  bugSendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  bugSendText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  bugFooter: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", marginTop: 8 },
});
