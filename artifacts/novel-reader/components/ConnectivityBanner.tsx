import React, { useEffect, useRef } from "react";
import { Text, StyleSheet, Animated, Pressable } from "react-native";

interface ConnectivityBannerProps {
  isVisible: boolean;
  type: "offline" | "online";
  onDismiss: () => void;
}

export function ConnectivityBanner({
  isVisible,
  type,
  onDismiss,
}: ConnectivityBannerProps) {
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (isVisible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible, slideAnim]);

  const backgroundColor = type === "offline" ? "#FF4444" : "#27AE60";
  const message =
    type === "offline"
      ? "No internet connection"
      : "Internet connectivity established";

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents={isVisible ? "auto" : "none"}
    >
      <Pressable style={styles.pressable} onPress={onDismiss}>
        <Text style={styles.text}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  pressable: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  text: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
