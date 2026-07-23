import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { LibraryProvider, useLibrary } from "@/context/LibraryContext";
import { UpdateProvider } from "@/context/UpdateContext";
import { WebViewFetchBridge } from "@/hooks/scrapers/shared/webviewBridge";

SplashScreen.preventAutoHideAsync();

// Native crash capture (segfaults/OOM/ANRs bypass the JS layer entirely,
// so this must be initialized as early as possible, before any other
// provider mounts). Reports upload automatically on next launch — no
// device access or logcat needed to read them; view them in the Sentry
// dashboard instead.
Sentry.init({
  dsn: "https://e1e9b0ec8fc5a41b3d0c5d965e554b8a@o4511728407609344.ingest.us.sentry.io/4511730500763648",
  tracesSampleRate: 0.2,
  // Keep breadcrumbs of nav/console so a crash report shows what led up to it
  // (e.g. "reading" vs "backup" vs "download") without needing repro steps.
  enableTombstone: true,
  // Android, when the app hard-crashes (native crash, not a JS error),
  // Android generates a "tombstone" file with the native crash dump. This flag tells the Sentry Android SDK
  // to read and attach that file to the crash report, giving you native stack traces instead
  // of just "app crashed" with no detail.
  enableAutoSessionTracking: true,
  // Session Replay — records a masked visual replay of user sessions.
  // 10% of normal sessions get recorded (replaysSessionSampleRate), but any
  // session that hits an error/crash gets recorded at 100% (replaysOnErrorSampleRate),
  // so a report like hers comes with an actual replay of what she was doing,
  // not just a stack trace. Text/images/vectors stay masked by default —
  // fine for a novel reader where screens include chapter content.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: true,
      maskAllImages: true,
      maskAllVectors: true,
    }),
  ],
});

const queryClient = new QueryClient();

// ── Init Screen Component ───────────────────────────────────────────────────

function InitScreen() {
  const { initSteps, initComplete } = useLibrary();
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Spinning animation for running steps
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      }),
    );

    if (!initComplete) {
      animation.start();
    } else {
      animation.stop();
    }

    return () => animation.stop();
  }, [initComplete, spinAnim]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Fade in when complete
  useEffect(() => {
    if (initComplete) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [initComplete, fadeAnim, slideAnim]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return "sync-outline";
      case "done":
        return "checkmark-circle";
      case "error":
        return "alert-circle";
      default:
        return "ellipse-outline";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return colors.accent;
      case "done":
        return "#27AE60";
      case "error":
        return "#FF4444";
      default:
        return colors.textMuted;
    }
  };

  return (
    <View
      style={[initStyles.container, { backgroundColor: colors.background }]}
    >
      <Animated.View
        style={[
          initStyles.content,
          {
            opacity: initComplete ? fadeAnim : 1,
            transform: [{ translateY: initComplete ? slideAnim : 0 }],
          },
        ]}
      >
        {/* App Logo */}
        <View style={initStyles.logoContainer}>
          <Ionicons name="book-outline" size={64} color={colors.accent} />
        </View>

        <Text style={[initStyles.title, { color: colors.text }]}>Novel DR</Text>
        <Text style={[initStyles.version, { color: colors.textSecondary }]}>
          v{Constants.expoConfig?.version ?? ""}
        </Text>

        {/* Progress Steps */}
        <View style={initStyles.stepsContainer}>
          {initSteps.map((step, index) => (
            <Animated.View
              key={step.id}
              style={[
                initStyles.stepRow,
                {
                  opacity: initComplete ? fadeAnim : 1,
                },
              ]}
            >
              {step.status === "running" ? (
                <Animated.View
                  style={{ transform: [{ rotate: spinInterpolation }] }}
                >
                  <Ionicons
                    name="sync-outline"
                    size={18}
                    color={getStatusColor(step.status)}
                  />
                </Animated.View>
              ) : (
                <Ionicons
                  name={getStatusIcon(step.status)}
                  size={18}
                  color={getStatusColor(step.status)}
                />
              )}

              <View style={initStyles.stepTextContainer}>
                <Text style={[initStyles.stepMessage, { color: colors.text }]}>
                  {step.message}
                </Text>
                {step.detail && (
                  <Text
                    style={[
                      initStyles.stepDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {step.detail}
                  </Text>
                )}
              </View>
            </Animated.View>
          ))}
        </View>

        {/* Loading indicator or completion check */}
        <View style={initStyles.footerContainer}>
          {!initComplete ? (
            <View style={initStyles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text
                style={[
                  initStyles.loadingText,
                  { color: colors.textSecondary },
                ]}
              >
                Preparing your library...
              </Text>
            </View>
          ) : (
            <Animated.View
              style={[initStyles.completeRow, { opacity: fadeAnim }]}
            >
              <Ionicons name="checkmark-circle" size={24} color="#27AE60" />
              <Text style={[initStyles.completeText, { color: "#27AE60" }]}>
                Ready!
              </Text>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const initStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  content: {
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
  },
  logoContainer: {
    marginBottom: 12,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    marginBottom: 4,
  },
  version: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginBottom: 36,
  },
  stepsContainer: {
    width: "100%",
    gap: 14,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepTextContainer: {
    flex: 1,
  },
  stepMessage: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
  },
  stepDetail: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  footerContainer: {
    marginTop: 36,
    alignItems: "center",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  completeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  completeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
});

// ── Root Layout Components ──────────────────────────────────────────────────

function RootLayoutNav() {
  const { loading } = useLibrary();

  // Show init screen while loading
  if (loading) {
    return <InitScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="novel/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="reader/[id]"
        options={{ headerShown: false, presentation: "fullScreenModal" }}
      />
    </Stack>
  );
}

// ── Root Layout (with Providers) ────────────────────────────────────────────

export default Sentry.wrap(function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Wait for fonts before showing anything
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary
        onError={(error, stack) =>
          Sentry.captureException(error, {
            contexts: { react: { componentStack: stack } },
          })
        }
      >
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ThemeProvider>
              <LibraryProvider>
                <UpdateProvider>
                  <RootLayoutNav />
                  <WebViewFetchBridge />
                </UpdateProvider>
              </LibraryProvider>
            </ThemeProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
});
