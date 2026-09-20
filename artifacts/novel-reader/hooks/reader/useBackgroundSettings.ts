import { useCallback, useEffect, useState } from "react";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import {
  BG_SETTINGS_FILE,
  BG_PRESETS,
  isLightColor,
} from "@/constants/readerSettings";

type AdaptiveColors = {
  text: string;
  textSecondary: string;
  accent: string;
  surface: string;
  card: string;
  border: string;
};

export function useBackgroundSettings(
  themeColors: Record<string, string> = {},
) {
  const [bgPresetId, setBgPresetId] = useState<string>("none");
  const [bgCustomUri, setBgCustomUri] = useState<string | null>(null);
  const [adaptiveColors, setAdaptiveColors] = useState<AdaptiveColors>({
    text: themeColors.text || "#000000",
    textSecondary: themeColors.textSecondary || "#666666",
    accent: themeColors.accent || "#0066CC",
    surface: themeColors.surface || "#FFFFFF",
    card: themeColors.card || "#F5F5F5",
    border: themeColors.border || "#E0E0E0",
  });

  // Load background settings from disk
  useEffect(() => {
    (async () => {
      try {
        const bgInfo = await FileSystem.getInfoAsync(BG_SETTINGS_FILE);
        if (bgInfo.exists) {
          const bgContent =
            await FileSystem.readAsStringAsync(BG_SETTINGS_FILE);
          const bgSettings = JSON.parse(bgContent);
          if (bgSettings.presetId) setBgPresetId(bgSettings.presetId);
          if (bgSettings.customUri) setBgCustomUri(bgSettings.customUri);
        }
      } catch (e) {
        console.warn("Failed to load bg settings:", e);
      }
    })();
  }, []);

  // Get active preset
  const activePreset = BG_PRESETS.find((p) => p.id === bgPresetId);

  // Compute effective background color
  const bgImageUri = bgCustomUri ?? null;
  const bgSolidColor =
    !bgCustomUri && activePreset && activePreset.id !== "none"
      ? activePreset.color
      : null;
  const isNoneBackground = !bgCustomUri && activePreset?.id === "none";
  const effectiveBgColor = isNoneBackground
    ? themeColors.background
    : "transparent";

  // Update adaptive colors based on preset or custom image
  const updateAdaptiveColors = useCallback(async () => {
    if (bgCustomUri) {
      setAdaptiveColors({
        text: "#F0F0F0",
        textSecondary: "#B0B0B0",
        accent: "#58A6FF",
        surface: "rgba(30, 30, 40, 0.85)",
        card: "rgba(20, 20, 30, 0.85)",
        border: "rgba(100, 100, 120, 0.5)",
      });
    } else if (activePreset && activePreset.id !== "none") {
      setAdaptiveColors({
        text: activePreset.textColor,
        textSecondary: activePreset.textColorSecondary,
        accent: activePreset.accentColor || themeColors.accent || "#0066CC",
        surface: isLightColor(activePreset.color)
          ? "rgba(255, 255, 255, 0.9)"
          : "rgba(0, 0, 0, 0.7)",
        card: isLightColor(activePreset.color)
          ? "rgba(255, 255, 255, 0.85)"
          : "rgba(0, 0, 0, 0.6)",
        border: isLightColor(activePreset.color)
          ? "rgba(0, 0, 0, 0.1)"
          : "rgba(255, 255, 255, 0.1)",
      });
    } else {
      setAdaptiveColors({
        text: themeColors.text || "#000000",
        textSecondary: themeColors.textSecondary || "#666666",
        accent: themeColors.accent || "#0066CC",
        surface: themeColors.surface || "#FFFFFF",
        card: themeColors.card || "#F5F5F5",
        border: themeColors.border || "#E0E0E0",
      });
    }
  }, [bgCustomUri, activePreset, themeColors]);

  useEffect(() => {
    updateAdaptiveColors();
  }, [bgPresetId, bgCustomUri, updateAdaptiveColors]);

  // Save background settings to disk
  const saveBgSettings = async (presetId: string, customUri: string | null) => {
    try {
      const dir = `${FileSystem.documentDirectory}NovelDR/`;
      const di = await FileSystem.getInfoAsync(dir);
      if (!di.exists)
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(
        BG_SETTINGS_FILE,
        JSON.stringify({ presetId, customUri }),
      );
    } catch (e) {
      console.warn("Failed to save bg settings:", e);
    }
  };

  // Pick custom background image
  const pickCustomImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setBgCustomUri(uri);
      setBgPresetId("none");
      saveBgSettings("none", uri);
      setAdaptiveColors({
        text: "#F0F0F0",
        textSecondary: "#B0B0B0",
        accent: "#58A6FF",
        surface: "rgba(30, 30, 40, 0.85)",
        card: "rgba(20, 20, 30, 0.85)",
        border: "rgba(100, 100, 120, 0.5)",
      });
      return true;
    }
    return false;
  };

  // Select a preset
  const selectPreset = (preset: (typeof BG_PRESETS)[0]) => {
    setBgPresetId(preset.id);
    setBgCustomUri(null);
    saveBgSettings(preset.id, null);
  };

  return {
    bgPresetId,
    setBgPresetId,
    bgCustomUri,
    setBgCustomUri,
    adaptiveColors,
    activePreset,
    bgImageUri,
    bgSolidColor,
    isNoneBackground,
    effectiveBgColor,
    pickCustomImage,
    selectPreset,
    saveBgSettings,
  };
}
