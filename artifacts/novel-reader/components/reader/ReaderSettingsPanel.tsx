import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AUTO_SCROLL_SPEEDS,
  BG_PRESETS,
  FONT_PRESETS,
  FONT_SIZES,
  LINE_SPACINGS,
  MARGIN_PRESETS,
} from "@/constants/readerSettings";

interface AdaptiveColors {
  text: string;
  textSecondary: string;
  accent: string;
  surface: string;
  card: string;
  border: string;
}

// Mirrors the CustomFont type defined in app/reader/[id].tsx - not imported
// from constants since custom fonts are discovered at runtime, not declared
// statically like FONT_PRESETS.
type CustomFont = {
  filename: string;
  label: string;
  familyName: string;
};

interface ReaderSettingsPanelProps {
  adaptiveColors: AdaptiveColors;
  bottomPad: number;

  // Settings bottom sheet visibility
  showSettingsSheet: boolean;
  setShowSettingsSheet: (v: boolean) => void;

  // Font
  // Shape-compatible with (typeof FONT_PRESETS)[number] but widened since
  // this can also represent the currently active custom (user-imported)
  // font, which isn't one of the static FONT_PRESETS entries.
  activeFontPreset: {
    id: string;
    label: string;
    regularFamily: string;
    boldFamily: string;
  };
  fontPresetId: string;
  // Selecting a built-in preset also needs to clear any active custom
  // font, so [id].tsx owns the whole selection + persistence flow here
  // rather than this panel poking fontPresetId state directly.
  selectBuiltinFontPreset: (id: string) => void;
  showFontModal: boolean;
  setShowFontModal: (v: boolean) => void;

  // Custom (user-imported) fonts
  customFonts: CustomFont[];
  activeFontFilename: string | null;
  onSelectCustomFont: (font: CustomFont) => void;
  onDeleteCustomFont: (font: CustomFont) => void;
  onImportFont: () => void;
  importingFont: boolean;

  // Font size
  fontSize: number;
  fontSizeIdx: number;
  setFontSizeIdx: (idx: number) => void;

  // Line spacing
  lineSpacing: number;
  lineSpacingIdx: number;
  setLineSpacingIdx: (idx: number) => void;

  // Auto scroll
  autoScrollActive: boolean;
  startAutoScroll: () => void;
  stopAutoScroll: () => void;
  currentSpeed: number;
  autoScrollSpeedIdx: number;
  setAutoScrollSpeedIdx: (idx: number) => void;

  // TTS auto next row (only shown while TTS is active)
  ttsActive: boolean;
  ttsAutoNext: boolean;
  toggleTtsAutoNext: () => void;

  // Margins
  marginPresetIdx: number;
  setMarginPresetIdx: (idx: number) => void;

  // Background
  bgPresetId: string;
  bgCustomUri: string | null;
  bgSolidColor: string | null;
  pickCustomImage: () => void;
  selectPreset: (preset: (typeof BG_PRESETS)[number]) => void;
  showBgModal: boolean;
  setShowBgModal: (v: boolean) => void;

  // Persistence — same signature/behavior as in [id].tsx, just called from
  // here instead.
  saveAllSettings: (
    fontSize: number,
    lineSpacing: number,
    margin: number,
    scroll: number,
  ) => Promise<void>;
}

export default function ReaderSettingsPanel({
  adaptiveColors,
  bottomPad,
  showSettingsSheet,
  setShowSettingsSheet,
  activeFontPreset,
  fontPresetId,
  selectBuiltinFontPreset,
  showFontModal,
  setShowFontModal,
  customFonts,
  activeFontFilename,
  onSelectCustomFont,
  onDeleteCustomFont,
  onImportFont,
  importingFont,
  fontSize,
  fontSizeIdx,
  setFontSizeIdx,
  lineSpacing,
  lineSpacingIdx,
  setLineSpacingIdx,
  autoScrollActive,
  startAutoScroll,
  stopAutoScroll,
  currentSpeed,
  autoScrollSpeedIdx,
  setAutoScrollSpeedIdx,
  ttsActive,
  ttsAutoNext,
  toggleTtsAutoNext,
  marginPresetIdx,
  setMarginPresetIdx,
  bgPresetId,
  bgCustomUri,
  bgSolidColor,
  pickCustomImage,
  selectPreset,
  showBgModal,
  setShowBgModal,
  saveAllSettings,
}: ReaderSettingsPanelProps) {
  return (
    <>
      {/* ─── SETTINGS BOTTOM SHEET ─── */}
      <Modal
        visible={showSettingsSheet}
        animationType="fade"
        transparent
        onRequestClose={() => setShowSettingsSheet(false)}
      >
        <Pressable
          style={styles.overlayDismiss}
          onPress={() => setShowSettingsSheet(false)}
        >
          <Pressable
            style={[
              styles.settingsSheet,
              {
                backgroundColor: adaptiveColors.surface,
                borderColor: adaptiveColors.border,
              },
            ]}
            onPress={() => {}}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: adaptiveColors.border },
              ]}
            />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomPad + 32 }}
            >
              {/* FONT */}
              <Text
                style={[
                  styles.sectionLabel,
                  { color: adaptiveColors.textSecondary },
                ]}
              >
                FONT
              </Text>
              <Pressable
                style={[
                  styles.fontSelectBtn,
                  {
                    borderColor: adaptiveColors.border,
                    backgroundColor: adaptiveColors.card,
                  },
                ]}
                onPress={() => setShowFontModal(true)}
              >
                <Text
                  style={[
                    styles.fontSelectText,
                    {
                      fontFamily: activeFontPreset.regularFamily,
                      color: adaptiveColors.text,
                    },
                  ]}
                >
                  {activeFontPreset.label}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={adaptiveColors.textSecondary}
                />
              </Pressable>

              {/* FONT SIZE */}
              <View style={styles.rowGroup}>
                <Text
                  style={[
                    styles.rowGroupLabel,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  FONT SIZE
                </Text>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.max(0, fontSizeIdx - 1);
                    setFontSizeIdx(newIdx);
                    saveAllSettings(
                      newIdx,
                      lineSpacingIdx,
                      marginPresetIdx,
                      autoScrollSpeedIdx,
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.controlBtnText,
                      { color: adaptiveColors.text, fontSize: 14 },
                    ]}
                  >
                    A
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.controlValueCenteredSmall,
                    { color: adaptiveColors.text },
                  ]}
                >
                  {fontSize}PT
                </Text>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.min(
                      FONT_SIZES.length - 1,
                      fontSizeIdx + 1,
                    );
                    setFontSizeIdx(newIdx);
                    saveAllSettings(
                      newIdx,
                      lineSpacingIdx,
                      marginPresetIdx,
                      autoScrollSpeedIdx,
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.controlBtnText,
                      { color: adaptiveColors.text, fontSize: 18 },
                    ]}
                  >
                    A
                  </Text>
                </Pressable>
              </View>

              {/* LINE SPACING */}
              <View style={styles.rowGroup}>
                <Text
                  style={[
                    styles.rowGroupLabel,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  LINE SPACING
                </Text>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.max(0, lineSpacingIdx - 1);
                    setLineSpacingIdx(newIdx);
                    saveAllSettings(
                      fontSizeIdx,
                      newIdx,
                      marginPresetIdx,
                      autoScrollSpeedIdx,
                    );
                  }}
                >
                  <Ionicons
                    name="remove"
                    size={18}
                    color={adaptiveColors.text}
                  />
                </Pressable>
                <Text
                  style={[
                    styles.controlValueCenteredSmall,
                    { color: adaptiveColors.text },
                  ]}
                >
                  {lineSpacing.toFixed(1)}X
                </Text>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.min(
                      LINE_SPACINGS.length - 1,
                      lineSpacingIdx + 1,
                    );
                    setLineSpacingIdx(newIdx);
                    saveAllSettings(
                      fontSizeIdx,
                      newIdx,
                      marginPresetIdx,
                      autoScrollSpeedIdx,
                    );
                  }}
                >
                  <Ionicons name="add" size={18} color={adaptiveColors.text} />
                </Pressable>
              </View>

              {/* AUTO SCROLL */}
              <View style={styles.rowGroup}>
                <Text
                  style={[
                    styles.rowGroupLabel,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  AUTO SCROLL
                </Text>
                <Pressable
                  style={[
                    styles.autoScrollPlayBtnSmall,
                    {
                      backgroundColor: autoScrollActive
                        ? adaptiveColors.accent
                        : adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() =>
                    autoScrollActive ? stopAutoScroll() : startAutoScroll()
                  }
                >
                  <Ionicons
                    name={autoScrollActive ? "pause" : "play"}
                    size={16}
                    color={autoScrollActive ? "#fff" : adaptiveColors.text}
                  />
                </Pressable>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.max(0, autoScrollSpeedIdx - 1);
                    setAutoScrollSpeedIdx(newIdx);
                    saveAllSettings(
                      fontSizeIdx,
                      lineSpacingIdx,
                      marginPresetIdx,
                      newIdx,
                    );
                  }}
                >
                  <Ionicons
                    name="remove"
                    size={18}
                    color={adaptiveColors.text}
                  />
                </Pressable>
                <Text
                  style={[
                    styles.controlValueCenteredSmall,
                    { color: adaptiveColors.text },
                  ]}
                >
                  {currentSpeed.toFixed(1)}X
                </Text>
                <Pressable
                  style={[
                    styles.controlBtnSmall,
                    {
                      backgroundColor: adaptiveColors.card,
                      borderColor: adaptiveColors.border,
                    },
                  ]}
                  onPress={() => {
                    const newIdx = Math.min(
                      AUTO_SCROLL_SPEEDS.length - 1,
                      autoScrollSpeedIdx + 1,
                    );
                    setAutoScrollSpeedIdx(newIdx);
                    saveAllSettings(
                      fontSizeIdx,
                      lineSpacingIdx,
                      marginPresetIdx,
                      newIdx,
                    );
                  }}
                >
                  <Ionicons name="add" size={18} color={adaptiveColors.text} />
                </Pressable>
              </View>

              {/* TTS AUTO NEXT */}
              {ttsActive && (
                <View style={styles.rowGroup}>
                  <Text
                    style={[
                      styles.rowGroupLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    TTS AUTO NEXT
                  </Text>
                  <Pressable
                    style={[
                      styles.autoNextToggleBtn,
                      {
                        backgroundColor: ttsAutoNext
                          ? adaptiveColors.accent
                          : adaptiveColors.card,
                        borderColor: adaptiveColors.border,
                      },
                    ]}
                    onPress={toggleTtsAutoNext}
                  >
                    <Ionicons
                      name={
                        ttsAutoNext ? "checkmark-circle" : "ellipse-outline"
                      }
                      size={15}
                      color={ttsAutoNext ? "#fff" : adaptiveColors.text}
                    />
                    <Text
                      style={[
                        styles.autoNextToggleText,
                        { color: ttsAutoNext ? "#fff" : adaptiveColors.text },
                      ]}
                    >
                      {ttsAutoNext ? "On" : "Off"}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* MARGINS */}
              <Text
                style={[
                  styles.sectionLabel,
                  { color: adaptiveColors.textSecondary, marginTop: 4 },
                ]}
              >
                MARGINS
              </Text>
              <View style={styles.marginRow}>
                {MARGIN_PRESETS.map((label, idx) => (
                  <Pressable
                    key={idx}
                    style={[
                      styles.marginPresetBtn,
                      {
                        backgroundColor:
                          marginPresetIdx === idx
                            ? adaptiveColors.accent
                            : adaptiveColors.card,
                        borderColor:
                          marginPresetIdx === idx
                            ? adaptiveColors.accent
                            : adaptiveColors.border,
                      },
                    ]}
                    onPress={() => {
                      setMarginPresetIdx(idx);
                      saveAllSettings(
                        fontSizeIdx,
                        lineSpacingIdx,
                        idx,
                        autoScrollSpeedIdx,
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.marginPresetText,
                        {
                          color:
                            marginPresetIdx === idx
                              ? "#fff"
                              : adaptiveColors.text,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* BACKGROUND */}
              <Text
                style={[
                  styles.sectionLabel,
                  { color: adaptiveColors.textSecondary, marginTop: 12 },
                ]}
              >
                BACKGROUND
              </Text>
              <View style={styles.bgRow}>
                <Pressable
                  style={[
                    styles.bgCurrentBtn,
                    {
                      borderColor: adaptiveColors.border,
                      backgroundColor: adaptiveColors.card,
                    },
                  ]}
                  onPress={pickCustomImage}
                >
                  {bgCustomUri ? (
                    <Image
                      source={{ uri: bgCustomUri }}
                      style={styles.bgCurrentImage}
                      resizeMode="cover"
                    />
                  ) : bgSolidColor && bgSolidColor !== "transparent" ? (
                    <View
                      style={[
                        styles.bgCurrentImage,
                        { backgroundColor: bgSolidColor },
                      ]}
                    />
                  ) : (
                    <View style={styles.bgCurrentEmpty}>
                      <Ionicons
                        name="image-outline"
                        size={22}
                        color={adaptiveColors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.bgCurrentLabel,
                          { color: adaptiveColors.textSecondary },
                        ]}
                      >
                        Custom
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.bgBtnLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    Current Image
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.bgPresetsBtn,
                    {
                      borderColor: adaptiveColors.border,
                      backgroundColor: adaptiveColors.card,
                    },
                  ]}
                  onPress={() => setShowBgModal(true)}
                >
                  <View style={styles.bgPresetsGrid}>
                    {BG_PRESETS.slice(1, 5).map((p) => (
                      <View
                        key={p.id}
                        style={[
                          styles.bgPresetsGridCell,
                          { backgroundColor: p.color },
                        ]}
                      />
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.bgBtnLabel,
                      { color: adaptiveColors.textSecondary },
                    ]}
                  >
                    Presets
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── BACKGROUND PRESETS MODAL ─── */}
      <Modal
        visible={showBgModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowBgModal(false)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: adaptiveColors.surface },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: adaptiveColors.text }]}>
                Background Presets
              </Text>
              <Pressable
                onPress={() => setShowBgModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={24} color={adaptiveColors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.bgPresetsList}>
              {BG_PRESETS.map((preset) => {
                const isActive = bgPresetId === preset.id && !bgCustomUri;
                return (
                  <Pressable
                    key={preset.id}
                    style={[
                      styles.bgPresetItem,
                      {
                        borderColor: isActive
                          ? adaptiveColors.accent
                          : adaptiveColors.border,
                        borderWidth: isActive ? 2 : 1,
                      },
                    ]}
                    onPress={() => selectPreset(preset)}
                  >
                    <View
                      style={[
                        styles.bgPresetSwatch,
                        { backgroundColor: preset.color, overflow: "hidden" },
                      ]}
                    >
                      {preset.type === "gradient" && preset.color2 && (
                        <View
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: "50%",
                            backgroundColor: preset.color2,
                          }}
                        />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.bgPresetLabel,
                        {
                          color: isActive
                            ? adaptiveColors.accent
                            : adaptiveColors.text,
                        },
                      ]}
                    >
                      {preset.label}
                    </Text>
                    {isActive && (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={adaptiveColors.accent}
                      />
                    )}
                  </Pressable>
                );
              })}
              <Pressable
                style={[
                  styles.bgPresetItem,
                  {
                    borderColor: bgCustomUri
                      ? adaptiveColors.accent
                      : adaptiveColors.border,
                    borderWidth: bgCustomUri ? 2 : 1,
                  },
                ]}
                onPress={pickCustomImage}
              >
                <View
                  style={[
                    styles.bgPresetSwatch,
                    {
                      backgroundColor: adaptiveColors.card,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  ]}
                >
                  {bgCustomUri ? (
                    <Image
                      source={{ uri: bgCustomUri }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Ionicons
                      name="add"
                      size={22}
                      color={adaptiveColors.textSecondary}
                    />
                  )}
                </View>
                <Text
                  style={[
                    styles.bgPresetLabel,
                    {
                      color: bgCustomUri
                        ? adaptiveColors.accent
                        : adaptiveColors.text,
                    },
                  ]}
                >
                  {bgCustomUri ? "Custom (tap to change)" : "Pick from Gallery"}
                </Text>
                {bgCustomUri && (
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={adaptiveColors.accent}
                  />
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── FONT PICKER MODAL ─── */}
      <Modal
        visible={showFontModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFontModal(false)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: adaptiveColors.surface },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text
                  style={[styles.modalTitle, { color: adaptiveColors.text }]}
                >
                  Available Fonts
                </Text>
                <Text
                  style={[
                    styles.fontModalSubtitle,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  Long-press a custom font to delete
                </Text>
              </View>
              <Pressable
                onPress={() => setShowFontModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={24} color={adaptiveColors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.bgPresetsList}>
              {FONT_PRESETS.map((preset) => {
                const isActive =
                  !activeFontFilename && fontPresetId === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    style={[
                      styles.bgPresetItem,
                      {
                        borderColor: isActive
                          ? adaptiveColors.accent
                          : adaptiveColors.border,
                        borderWidth: isActive ? 2 : 1,
                      },
                    ]}
                    onPress={() => selectBuiltinFontPreset(preset.id)}
                  >
                    <Text
                      style={[
                        styles.bgPresetLabel,
                        {
                          fontFamily: preset.regularFamily,
                          color: isActive
                            ? adaptiveColors.accent
                            : adaptiveColors.text,
                        },
                      ]}
                    >
                      {preset.label}
                    </Text>
                    {isActive && (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={adaptiveColors.accent}
                      />
                    )}
                  </Pressable>
                );
              })}

              {customFonts.map((font) => {
                const isActive = activeFontFilename === font.filename;
                return (
                  <Pressable
                    key={font.filename}
                    style={[
                      styles.bgPresetItem,
                      {
                        borderColor: isActive
                          ? adaptiveColors.accent
                          : adaptiveColors.border,
                        borderWidth: isActive ? 2 : 1,
                      },
                    ]}
                    onPress={() => onSelectCustomFont(font)}
                    onLongPress={() => onDeleteCustomFont(font)}
                  >
                    <Text
                      style={[
                        styles.bgPresetLabel,
                        {
                          fontFamily: font.familyName,
                          color: isActive
                            ? adaptiveColors.accent
                            : adaptiveColors.text,
                        },
                      ]}
                    >
                      Added: {font.label}
                    </Text>
                    {isActive && (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={adaptiveColors.accent}
                      />
                    )}
                  </Pressable>
                );
              })}

              <Pressable
                style={[
                  styles.bgPresetItem,
                  styles.importFontBtn,
                  { borderColor: adaptiveColors.border },
                ]}
                onPress={onImportFont}
                disabled={importingFont}
              >
                {importingFont ? (
                  <ActivityIndicator
                    size="small"
                    color={adaptiveColors.textSecondary}
                  />
                ) : (
                  <Ionicons
                    name="folder-open-outline"
                    size={18}
                    color={adaptiveColors.textSecondary}
                  />
                )}
                <Text
                  style={[
                    styles.bgPresetLabel,
                    { color: adaptiveColors.textSecondary },
                  ]}
                >
                  {importingFont ? "Importing…" : "Import Custom Font"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Shared with other modals in [id].tsx (TTS settings, etc.) — duplicated
  // here rather than imported, since they still live in [id].tsx's own
  // StyleSheet too and this component must stay self-contained.
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    minHeight: "50%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  fontModalSubtitle: { fontSize: 12, marginTop: 2 },
  modalCloseBtn: { padding: 4 },

  // Exclusive to this panel — moved out of [id].tsx's StyleSheet.
  overlayDismiss: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  settingsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: "70%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  rowGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  rowGroupLabel: { fontSize: 13, fontWeight: "600", flex: 1 },
  controlValueCenteredSmall: {
    fontSize: 15,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "center",
  },
  controlBtnSmall: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
  },
  autoScrollPlayBtnSmall: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 8,
  },
  autoNextToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  autoNextToggleText: { fontSize: 13, fontWeight: "600" },
  controlBtnText: { fontWeight: "600" },
  fontSelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  fontSelectText: { fontSize: 15, fontWeight: "600" },
  marginRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  marginPresetBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  marginPresetText: { fontSize: 13, fontWeight: "500" },
  bgRow: { flexDirection: "row", gap: 12, marginBottom: 8 },
  bgCurrentBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  bgCurrentImage: { width: "100%", height: 60 },
  bgCurrentEmpty: {
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  bgCurrentLabel: { fontSize: 10 },
  bgBtnLabel: { fontSize: 11, textAlign: "center", paddingVertical: 6 },
  bgPresetsBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  bgPresetsGrid: { flexDirection: "row", flexWrap: "wrap", height: 60 },
  bgPresetsGridCell: { width: "50%", height: "50%" },
  bgPresetsList: { paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  bgPresetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    padding: 10,
  },
  bgPresetSwatch: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: "hidden",
  },
  bgPresetLabel: { fontSize: 14, fontWeight: "500", flex: 1 },
  importFontBtn: { justifyContent: "center" },
});
