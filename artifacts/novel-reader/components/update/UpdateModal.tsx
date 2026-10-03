import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import type { UpdateFlow } from "@/hooks/useUpdateFlow";
import { ChangelogMarkdown } from "./ChangelogMarkdown";

export function UpdateModal({ flow }: { flow: UpdateFlow }) {
  const { colors } = useTheme();
  const { info, visible, phase, progress, close, download, apply, skip } = flow;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={s.overlay}>
        <View
          style={[
            s.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={s.header}>
            <Text style={[s.title, { color: colors.text }]}>
              Update available
            </Text>
            {phase === "idle" && (
              <Pressable onPress={close}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>

          <Text style={[s.versionRow, { color: colors.textMuted }]}>
            v{Constants.expoConfig?.version ?? "?"} → {info?.tag ?? ""}
          </Text>

          <ScrollView
            style={[
              s.notesBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {info?.notes?.trim() ? (
              <ChangelogMarkdown source={info.notes} />
            ) : (
              <Text style={[s.emptyNotes, { color: colors.textSecondary }]}>
                No release notes provided.
              </Text>
            )}
          </ScrollView>

          {phase === "idle" && (
            <Pressable
              style={[s.actionBtn, { backgroundColor: colors.accent }]}
              onPress={download}
            >
              <Text style={s.actionBtnText}>Download update</Text>
            </Pressable>
          )}

          {phase === "downloading" && (
            <View
              style={[s.progressTrack, { backgroundColor: colors.surface }]}
            >
              <View
                style={[
                  s.progressFill,
                  { width: `${progress}%`, backgroundColor: colors.accent },
                ]}
              />
              <Text style={[s.progressLabel, { color: colors.text }]}>
                {progress}%
              </Text>
            </View>
          )}

          {phase === "ready" && (
            <Pressable
              style={[s.actionBtn, { backgroundColor: colors.accent }]}
              onPress={apply}
            >
              <Text style={s.actionBtnText}>Apply update</Text>
            </Pressable>
          )}

          {phase === "installing" && (
            <View
              style={[
                s.actionBtn,
                {
                  backgroundColor: colors.accent,
                  flexDirection: "row",
                  gap: 8,
                },
              ]}
            >
              <ActivityIndicator size="small" color="#fff" />
              <Text style={s.actionBtnText}>Opening installer...</Text>
            </View>
          )}

          {phase === "idle" && (
            <View style={s.secondaryRow}>
              <Pressable onPress={close}>
                <Text style={[s.secondaryText, { color: colors.textMuted }]}>
                  Remind me later
                </Text>
              </Pressable>
              <Pressable onPress={skip}>
                <Text style={[s.secondaryText, { color: colors.textMuted }]}>
                  Skip this version
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 4,
    width: "88%",
    maxWidth: 400,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  versionRow: { fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 8 },
  notesBox: {
    maxHeight: 260, // was 160 — formatted notes need more room
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 14,
  },
  emptyNotes: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 19 },
  actionBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
  progressTrack: {
    height: 40,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 10,
  },
  progressLabel: {
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  secondaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  secondaryText: { fontFamily: "Inter_400Regular", fontSize: 12 },
});
