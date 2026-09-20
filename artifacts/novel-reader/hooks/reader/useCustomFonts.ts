import { useCallback, useEffect, useState } from "react";
import * as FileSystem from "expo-file-system";
import * as Font from "expo-font";
import * as DocumentPicker from "expo-document-picker";
import { FONT_PRESETS } from "@/constants/readerSettings";

type CustomFont = {
  filename: string; // name on disk inside CUSTOM_FONTS_DIR
  label: string; // display name, derived from filename
  familyName: string; // family name registered with Font.loadAsync
};

const CUSTOM_FONTS_DIR = `${FileSystem.documentDirectory}NovelDR/custom_fonts/`;
const FONT_FILE_EXT_RE = /\.(ttf|otf)$/i;

// Small deterministic string hash for unique family names
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function familyNameForFilename(filename: string): string {
  const base = filename
    .replace(FONT_FILE_EXT_RE, "")
    .replace(/[^a-zA-Z0-9]/g, "_");
  return `CustomFont_${base}_${hashString(filename)}`;
}

export function useCustomFonts(
  activeFontFilename: string | null,
  setActiveFontFilename: (filename: string | null) => void,
) {
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [importingFont, setImportingFont] = useState(false);

  // Scan custom_fonts/ and register with expo-font
  const scanCustomFonts = useCallback(async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(CUSTOM_FONTS_DIR);
      if (!dirInfo.exists) {
        setCustomFonts([]);
        return;
      }
      const filenames = await FileSystem.readDirectoryAsync(CUSTOM_FONTS_DIR);
      const loaded: CustomFont[] = [];

      for (const filename of filenames) {
        if (!FONT_FILE_EXT_RE.test(filename)) continue;
        const familyName = familyNameForFilename(filename);
        try {
          await Font.loadAsync({
            [familyName]: `${CUSTOM_FONTS_DIR}${filename}`,
          });
          loaded.push({
            filename,
            label: filename.replace(FONT_FILE_EXT_RE, ""),
            familyName,
          });
        } catch (err) {
          console.warn(`Failed to load custom font "${filename}":`, err);
        }
      }
      setCustomFonts(loaded);

      // If active font disappeared, fall back to default
      if (
        activeFontFilename &&
        !loaded.some((f) => f.filename === activeFontFilename)
      ) {
        setActiveFontFilename(null);
      }
    } catch (error) {
      console.error("Failed to scan custom fonts:", error);
    }
  }, [activeFontFilename, setActiveFontFilename]);

  // Import a font file from document picker
  const importFont = useCallback(async () => {
    setImportingFont(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/font-ttf", "application/font-otf"],
      });

      if (!result.canceled && result.assets[0]) {
        const sourceUri = result.assets[0].uri;
        const filename = result.assets[0].name;

        // Ensure target directory exists
        const dirInfo = await FileSystem.getInfoAsync(CUSTOM_FONTS_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(CUSTOM_FONTS_DIR, {
            intermediates: true,
          });
        }

        // Copy to custom fonts directory
        const targetUri = `${CUSTOM_FONTS_DIR}${filename}`;
        await FileSystem.copyAsync({ from: sourceUri, to: targetUri });

        console.log(`✓ Imported font: ${filename}`);

        // Rescan to pick up the new font
        await scanCustomFonts();
      }
    } catch (error) {
      console.error("Failed to import font:", error);
    } finally {
      setImportingFont(false);
    }
  }, [scanCustomFonts]);

  // Delete a custom font by filename
  const deleteFont = useCallback(
    async (filename: string) => {
      try {
        const targetUri = `${CUSTOM_FONTS_DIR}${filename}`;
        await FileSystem.deleteAsync(targetUri);

        // If the deleted font was active, reset to default
        if (activeFontFilename === filename) {
          setActiveFontFilename(null);
        }

        console.log(`✓ Deleted font: ${filename}`);
        await scanCustomFonts();
      } catch (error) {
        console.error(`Failed to delete font "${filename}":`, error);
      }
    },
    [activeFontFilename, setActiveFontFilename, scanCustomFonts],
  );

  // Get the active font preset (custom or built-in)
  const activeCustomFont = activeFontFilename
    ? customFonts.find((f) => f.filename === activeFontFilename)
    : undefined;

  const activeFontPreset = activeCustomFont
    ? {
        id: `custom:${activeCustomFont.filename}`,
        label: activeCustomFont.label,
        regularFamily: activeCustomFont.familyName,
        boldFamily: activeCustomFont.familyName,
      }
    : undefined;

  return {
    customFonts,
    activeFontFilename,
    setActiveFontFilename,
    importingFont,
    activeCustomFont,
    activeFontPreset,
    scanCustomFonts,
    importFont,
    deleteFont,
  };
}
