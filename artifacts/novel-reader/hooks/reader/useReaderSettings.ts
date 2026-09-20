import { useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";
import {
  FONT_SIZES,
  LINE_SPACINGS,
  AUTO_SCROLL_SPEEDS,
  MARGIN_PRESETS,
  FONT_PRESETS,
  READER_SETTINGS_FILE,
} from "@/constants/readerSettings";

type ReaderSettingsState = {
  fontSizeIdx: number;
  lineSpacingIdx: number;
  marginPresetIdx: number;
  autoScrollSpeedIdx: number;
  fontPresetId: string;
  activeFontFilename: string | null;
};

export function useReaderSettings() {
  const [fontSizeIdx, setFontSizeIdx] = useState(3);
  const [lineSpacingIdx, setLineSpacingIdx] = useState(2);
  const [marginPresetIdx, setMarginPresetIdx] = useState(1);
  const [autoScrollSpeedIdx, setAutoScrollSpeedIdx] = useState(1);
  const [fontPresetId, setFontPresetId] = useState<string>("default");
  const [activeFontFilename, setActiveFontFilename] = useState<string | null>(
    null,
  );
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Refs for synchronous reads (used by saveAllSettings before state updates)
  const fontPresetIdRef = useRef(fontPresetId);
  const activeFontFilenameRef = useRef<string | null>(activeFontFilename);

  // Keep refs in sync with state
  useEffect(() => {
    fontPresetIdRef.current = fontPresetId;
  }, [fontPresetId]);

  useEffect(() => {
    activeFontFilenameRef.current = activeFontFilename;
  }, [activeFontFilename]);

  // Load settings from disk
  useEffect(() => {
    (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(READER_SETTINGS_FILE);
        if (fileInfo.exists) {
          const content =
            await FileSystem.readAsStringAsync(READER_SETTINGS_FILE);
          const settings = JSON.parse(content);
          if (settings.fontSizeIdx !== undefined)
            setFontSizeIdx(settings.fontSizeIdx);
          if (settings.lineSpacingIdx !== undefined)
            setLineSpacingIdx(settings.lineSpacingIdx);
          if (settings.marginPresetIdx !== undefined)
            setMarginPresetIdx(settings.marginPresetIdx);
          if (settings.autoScrollSpeedIdx !== undefined)
            setAutoScrollSpeedIdx(settings.autoScrollSpeedIdx);
          if (settings.fontPresetId !== undefined) {
            setFontPresetId(settings.fontPresetId);
            fontPresetIdRef.current = settings.fontPresetId;
          }
          if (settings.activeFontFilename !== undefined) {
            setActiveFontFilename(settings.activeFontFilename);
            activeFontFilenameRef.current = settings.activeFontFilename;
          }
        }
      } catch (error) {
        console.error("Failed to load reader settings:", error);
      }
      setSettingsLoaded(true);
    })();
  }, []);

  // Save settings to disk
  const saveSettings = async () => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      const settings: ReaderSettingsState = {
        fontSizeIdx,
        lineSpacingIdx,
        marginPresetIdx,
        autoScrollSpeedIdx,
        fontPresetId: fontPresetIdRef.current,
        activeFontFilename: activeFontFilenameRef.current,
      };

      await FileSystem.writeAsStringAsync(
        READER_SETTINGS_FILE,
        JSON.stringify(settings),
      );
    } catch (error) {
      console.error("Failed to save reader settings:", error);
    }
  };

  // Computed values
  const fontSize = FONT_SIZES[fontSizeIdx];
  const lineSpacing = LINE_SPACINGS[lineSpacingIdx];
  const marginPreset = MARGIN_PRESETS[marginPresetIdx];
  const autoScrollSpeed = AUTO_SCROLL_SPEEDS[autoScrollSpeedIdx];

  return {
    // State
    fontSizeIdx,
    setFontSizeIdx,
    lineSpacingIdx,
    setLineSpacingIdx,
    marginPresetIdx,
    setMarginPresetIdx,
    autoScrollSpeedIdx,
    setAutoScrollSpeedIdx,
    fontPresetId,
    setFontPresetId,
    activeFontFilename,
    setActiveFontFilename,
    settingsLoaded,

    // Refs for synchronous reads
    fontPresetIdRef,
    activeFontFilenameRef,

    // Computed values
    fontSize,
    lineSpacing,
    marginPreset,
    autoScrollSpeed,

    // Methods
    saveSettings,
  };
}
