import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import type {
  ExportEvent,
  ExportPhase,
  ExportProgress,
} from "../lib/exportRunner";

const STEPS: { key: ExportPhase[]; label: string }[] = [
  { key: ["checking", "reading"], label: "Read" },
  { key: ["building"], label: "Write" },
  { key: ["packaging"], label: "Package" },
  { key: ["done"], label: "Share" },
];

function stepIndex(phase: ExportPhase): number {
  const index = STEPS.findIndex((s) => s.key.includes(phase));
  return index === -1 ? 0 : index;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export type TimedEvent = ExportEvent & { at: number };

export function ExportProgressCard(props: {
  novelTitle: string;
  formatLabel: string;
  longMode: boolean;
  progress: ExportProgress;
  events: TimedEvent[];
  startedAt: number;
  // Cancel is shown only once an issue (warning or error) has been logged.
  cancelVisible: boolean;
  cancelling: boolean;
  onCancel: () => void;
  showFullLog: boolean;
  onToggleFullLog: () => void;
  now: number;
}) {
  const { colors } = useTheme();
  const { progress, events } = props;
  const percent =
    progress.chaptersTotal > 0
      ? Math.round((progress.chaptersDone / progress.chaptersTotal) * 100)
      : 0;
  const elapsed = props.now - props.startedAt;
  const perChapter =
    progress.chaptersDone > 0 ? elapsed / progress.chaptersDone : 0;
  const remainingChapters = Math.max(
    0,
    progress.chaptersTotal - progress.chaptersDone,
  );
  const etaMs = perChapter * remainingChapters;
  const current = stepIndex(progress.phase);
  const visibleEvents = props.showFullLog ? events : events.slice(-6);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        Exporting {props.novelTitle}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {props.formatLabel}
        {props.longMode ? ", large novel, written in parts" : ""}
      </Text>

      <View style={styles.steps}>
        {STEPS.map((step, i) => {
          const done = i < current || progress.phase === "done";
          const active = i === current && progress.phase !== "done";
          const color = done
            ? "#27AE60"
            : active
              ? colors.accent
              : colors.textMuted;
          return (
            <View key={step.label} style={styles.step}>
              <Ionicons
                name={done ? "checkmark" : active ? "sync" : "ellipse-outline"}
                size={16}
                color={color}
              />
              <Text style={[styles.stepLabel, { color }]}>{step.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.row}>
        <Text style={[styles.body, { color: colors.text }]}>
          Chapter {progress.chaptersDone} of {progress.chaptersTotal}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {percent}%
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.fill,
            { width: `${percent}%`, backgroundColor: colors.accent },
          ]}
        />
      </View>
      {progress.partTotal && progress.partTotal > 1 && (
        <Text style={[styles.small, { color: colors.textSecondary }]}>
          Part {progress.partNumber ?? 1} of {progress.partTotal}
        </Text>
      )}

      <View
        style={[
          styles.log,
          { borderColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <ScrollView>
          {visibleEvents.map((e, i) => {
            const color =
              e.level === "error"
                ? "#E74C3C"
                : e.level === "warn"
                  ? "#E67E22"
                  : e.level === "ok"
                    ? "#27AE60"
                    : colors.textSecondary;
            return (
              <View key={`${e.at}-${i}`} style={styles.logLine}>
                <Text style={[styles.logTime, { color: colors.textMuted }]}>
                  {clockOf(e.at)}
                </Text>
                <Text style={[styles.logText, { color }]}>{e.text}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.small, { color: colors.textSecondary }]}>
          Elapsed {formatClock(elapsed)}
          {etaMs > 0 && progress.phase !== "done"
            ? `, about ${formatClock(etaMs)} left`
            : ""}
        </Text>
        <View style={styles.buttons}>
          <Pressable onPress={props.onToggleFullLog} style={styles.button}>
            <Text style={[styles.buttonText, { color: colors.accent }]}>
              {props.showFullLog ? "Show less" : "Full log"}
            </Text>
          </Pressable>
          {props.cancelVisible && progress.phase !== "done" && (
            <Pressable
              onPress={props.onCancel}
              disabled={props.cancelling}
              style={styles.button}
            >
              <Text style={[styles.buttonText, { color: "#E74C3C" }]}>
                {props.cancelling ? "Stopping" : "Cancel"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    width: "100%",
    maxWidth: 360,
    gap: 8,
  },
  title: { fontFamily: "Inter_500Medium", fontSize: 16 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13 },
  steps: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  step: { alignItems: "center", gap: 4, flex: 1 },
  stepLabel: { fontFamily: "Inter_400Regular", fontSize: 11 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  body: { fontFamily: "Inter_400Regular", fontSize: 13 },
  small: { fontFamily: "Inter_400Regular", fontSize: 12 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  log: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    height: 150,
  },
  logLine: { flexDirection: "row", gap: 8, paddingVertical: 1 },
  logTime: { fontFamily: "Inter_400Regular", fontSize: 11, width: 62 },
  logText: { fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 },
  footer: { gap: 6, marginTop: 4 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  button: { paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
