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

// Reader-only fonts. They used to block the splash screen at launch; now they
// load in the background after the first screen is up and the reader waits for
// them (usually already done) before it shows text. Family names (the object
// keys) must match constants/readerSettings.ts FONT_PRESETS exactly.
const READER_FONTS = {
  Gelasio_400Regular,
  Gelasio_700Bold,
  Tinos_400Regular,
  Tinos_700Bold,
  ComicNeue_400Regular,
  ComicNeue_700Bold,
  OldStandardTT_400Regular,
  OldStandardTT_700Bold,
  // Not on Google Fonts - loaded directly from the bundled .ttf files.
  OpenDyslexic_400Regular: require("../assets/fonts/OpenDyslexic-Regular.ttf"),
  OpenDyslexic_700Bold: require("../assets/fonts/OpenDyslexic-Bold.ttf"),
};

let loaded = false;
let loadPromise: Promise<void> | null = null;

// Safe to call repeatedly. Never rejects: on failure the reader falls back to
// the system font (same as the old fontError path) and a later call retries.
export function loadReaderFonts(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = Font.loadAsync(READER_FONTS)
      .then(() => {
        loaded = true;
      })
      .catch((e) => {
        console.log("[readerFonts] load failed:", e);
        loadPromise = null;
      });
  }
  return loadPromise;
}

// True once the reader fonts have loaded (or failed - never blocks forever).
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
