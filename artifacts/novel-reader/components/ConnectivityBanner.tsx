import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ConnectivityBannerProps {
  isVisible: boolean;
  type: "offline" | "online";
  onDismiss: () => void;
}

const ANIM_MS = 250;

// Hardcoded rather than pulled from theme colors - the pill needs to render
// reliably regardless of which theme is active or how the theme context
// resolves, since this is a system-level status indicator, not themed UI.
const OFFLINE_COLOR = "#E53935";
const ONLINE_COLOR = "#27AE60";

export function ConnectivityBanner({
  isVisible,
  type,
  onDismiss,
}: ConnectivityBannerProps) {
  const insets = useSafeAreaInsets();

  // Kept mounted for a beat after isVisible flips to false so the
  // slide-out animation can finish before we unmount - otherwise the
  // pill would just vanish instead of animating away.
  const [mounted, setMounted] = useState(isVisible);
  const translateY = useRef(new Animated.Value(-60)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isVisible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: ANIM_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: ANIM_MS,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -60,
          duration: ANIM_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: ANIM_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [isVisible, translateY, opacity]);

  // Not position: "absolute" would reserve layout space even while
  // hidden (translateY only moves the box visually, it doesn't remove
  // it from flow) - that's what caused the permanent gap. Absolute
  // positioning + unmounting once fully hidden avoids that entirely.
  if (!mounted) return null;

  const backgroundColor = type === "offline" ? OFFLINE_COLOR : ONLINE_COLOR;
  const message =
    type === "offline"
      ? "No internet connection"
      : "Internet connectivity established";

  return (
    <Animated.View
      pointerEvents={isVisible ? "box-none" : "none"}
      style={[
        styles.wrapper,
        { top: insets.top + 8, opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable style={[styles.pill, { backgroundColor }]} onPress={onDismiss}>
        <Ionicons
          name={
            type === "online" ? "checkmark-circle" : "cloud-offline-outline"
          }
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    alignSelf: "center",
    zIndex: 1000,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: ONLINE_COLOR, // fallback; always overridden inline above
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
});
