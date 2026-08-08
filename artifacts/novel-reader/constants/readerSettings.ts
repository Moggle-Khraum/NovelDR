// constants/readerSettings.ts
import * as FileSystem from "expo-file-system";

export const FONT_SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26];
export const LINE_SPACINGS = [1.2, 1.3, 1.5, 1.8, 2.0, 2.5];
export const AUTO_SCROLL_SPEEDS = [0.5, 1, 1.5, 1.8, 2, 2.5];
export const MARGIN_PRESETS = ["Compact", "Comfortable", "Spacious"];
export const TTS_MIN_CHARS = 500;
export const RAPID_TAP_THRESHOLD = 4;
export const RAPID_TAP_WINDOW_MS = 1500;

export const READER_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/reader_settings.json`;
export const TTS_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/tts_simple_settings.json`;
export const BG_SETTINGS_FILE = `${FileSystem.documentDirectory}NovelDR/reader_bg.json`;

export type BgPreset = {
  id: string;
  label: string;
  type: "solid" | "gradient";
  color: string;
  color2?: string;
  textColor: string;
  textColorSecondary: string;
  accentColor?: string;
};

export const BG_PRESETS: BgPreset[] = [
  {
    id: "none",
    label: "None",
    type: "solid",
    color: "transparent",
    textColor: "#1A1A1A",
    textColorSecondary: "#666666",
  },
  {
    id: "parchment",
    label: "Parchment",
    type: "solid",
    color: "#F2E8D5",
    textColor: "#2C1810",
    textColorSecondary: "#8B6914",
    accentColor: "#8B4513",
  },
  {
    id: "night",
    label: "Night",
    type: "solid",
    color: "#0D1117",
    textColor: "#E8EDF2",
    textColorSecondary: "#8B949E",
    accentColor: "#58A6FF",
  },
  {
    id: "forest",
    label: "Forest",
    type: "solid",
    color: "#1A2E1A",
    textColor: "#D4E8D4",
    textColorSecondary: "#8BA888",
    accentColor: "#6B8E23",
  },
  {
    id: "ocean",
    label: "Ocean",
    type: "solid",
    color: "#0A1628",
    textColor: "#B8D4E8",
    textColorSecondary: "#6B8FB3",
    accentColor: "#4A90E2",
  },
  {
    id: "rose",
    label: "Rose",
    type: "solid",
    color: "#2A1020",
    textColor: "#F0D0E0",
    textColorSecondary: "#C980A0",
    accentColor: "#E87DA5",
  },
  {
    id: "slate",
    label: "Slate",
    type: "solid",
    color: "#1E2430",
    textColor: "#D8E0E8",
    textColorSecondary: "#8B98A8",
    accentColor: "#7E8A98",
  },
  {
    id: "grad_dusk",
    label: "Dusk",
    type: "gradient",
    color: "#1A0533",
    color2: "#0A1628",
    textColor: "#D8C8F0",
    textColorSecondary: "#A890C8",
    accentColor: "#9B6BFF",
  },
  {
    id: "grad_dawn",
    label: "Dawn",
    type: "gradient",
    color: "#2A1008",
    color2: "#1A0520",
    textColor: "#F0C8B8",
    textColorSecondary: "#C89878",
    accentColor: "#E87D5A",
  },
  {
    id: "grad_mist",
    label: "Mist",
    type: "gradient",
    color: "#E8EFF5",
    color2: "#F5F0E8",
    textColor: "#2A2A2A",
    textColorSecondary: "#6B6B6B",
    accentColor: "#4A6B8A",
  },
  {
    id: "grad_moss",
    label: "Moss",
    type: "gradient",
    color: "#1A2810",
    color2: "#0F1A18",
    textColor: "#C8E0B0",
    textColorSecondary: "#90B080",
    accentColor: "#7CB842",
  },
  {
    id: "grad_ember",
    label: "Ember",
    type: "gradient",
    color: "#1A0A00",
    color2: "#2A0800",
    textColor: "#F0A080",
    textColorSecondary: "#C87050",
    accentColor: "#FF6B3D",
  },
];

export function isLightColor(color: string): boolean {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}
