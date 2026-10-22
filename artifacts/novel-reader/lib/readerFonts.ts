import { useEffect, useState } from "react";
import * as Font from "expo-font";
import {
  Gelasio_400Regular,
  Gelasio_700Bold,
} from "@expo-google-fonts/gelasio";
import { Tinos_400Regular, Tinos_700Bold } from "@expo-google-fonts/tinos";
import {
  ComicNeue_400Regular,
  ComicNeue_700Bold,
} from "@expo-google-fonts/comic-neue";
import {
  OldStandardTT_400Regular,
  OldStandardTT_700Bold,
} from "@expo-google-fonts/old-standard-tt";

// Reader-only fonts load after the initial screen, so they don't block app startup.
// Family names must match constants/readerSettings.ts FONT_PRESETS exactly.
const READER_FONTS = {
  Gelasio_400Regular,
  Gelasio_700Bold,
  Tinos_400Regular,
  Tinos_700Bold,
  ComicNeue_400Regular,
  ComicNeue_700Bold,
  OldStandardTT_400Regular,
  OldStandardTT_700Bold,
  OpenDyslexic_400Regular: require("../assets/fonts/OpenDyslexic-Regular.ttf"),
  OpenDyslexic_700Bold: require("../assets/fonts/OpenDyslexic-Bold.ttf"),
};

let loaded = false;
let loadPromise: Promise<void> | null = null;

// Safe to call repeatedly. A font-loading failure falls back to system fonts,
// and a later call can retry rather than leaving the reader permanently blocked.
export function loadReaderFonts(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = Font.loadAsync(READER_FONTS)
      .then(() => {
        loaded = true;
      })
      .catch((error) => {
        console.warn("[readerFonts] load failed:", error);
        loadPromise = null;
      });
  }
  return loadPromise;
}

// The reader can wait for the font load before rendering chapter text.
export function useReaderFontsReady(): boolean {
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    if (loaded) {
      setReady(true);
      return;
    }
    let cancelled = false;
    loadReaderFonts().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
