// artifacts/novel-reader/app.config.js
import { withAndroidManifest } from "expo/config-plugins";

// Notifee's own manifest entry for its foreground service (used to keep
// TTS narration running when the app is backgrounded — Home, Recents, tab
// switch, screen lock) doesn't declare a foregroundServiceType. Android
// 14+ requires one, or starting the service throws
// MissingForegroundServiceTypeException. This declares it as
// "mediaPlayback" and overrides notifee's own entry via tools:replace.
function withNotifeeForegroundServiceType(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (!manifest.manifest.$["xmlns:tools"]) {
      manifest.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }
    const app = manifest.manifest.application?.[0];
    if (!app) return config;
    app.service = (app.service || []).filter(
      (s) => s.$?.["android:name"] !== "app.notifee.core.ForegroundService",
    );
    app.service.push({
      $: {
        "android:name": "app.notifee.core.ForegroundService",
        "android:foregroundServiceType": "mediaPlayback",
        "tools:replace": "android:foregroundServiceType",
      },
    });
    return config;
  });
}

export default () => {
  const buildNumber = process.env.APP_BUILD_NUMBER || "1";

  return {
    expo: {
      name: "Novel DR",
      slug: "novel-reader",
      version: "4.5.65",
      owner: "moggstones-stash",
      orientation: "portrait",
      icon: "./assets/images/icon.png",
      scheme: "novel-reader",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      splash: {
        image: "./assets/images/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
      ios: {
        supportsTablet: false,
        buildNumber: buildNumber,
      },
      android: {
        package: "com.noveldr.app",
        versionCode: parseInt(buildNumber, 10),
        permissions: [
          "REQUEST_INSTALL_PACKAGES",
          "POST_NOTIFICATIONS",
          "FOREGROUND_SERVICE",
          "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        ],
      },
      web: {
        favicon: "./assets/images/icon.png",
      },
      plugins: [
        [
          "expo-router",
          {
            origin: "https://replit.com/",
          },
        ],
        "expo-font",
        "expo-web-browser",
        [
          "expo-notifications",
          {
            icon: "./assets/images/icon.png",
            color: "#FFFFFF",
            sounds: [],
            modes: "production",
          },
        ],
        withNotifeeForegroundServiceType,
        [
          "@sentry/react-native/expo",
          {
            organization: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
          },
        ],
      ],
      experiments: {
        typedRoutes: true,
        reactCompiler: true,
      },
      extra: {
        eas: {
          projectId: "37b1e412-ff1c-47a2-993c-3b9e644f1770",
        },
      },
    },
  };
};
