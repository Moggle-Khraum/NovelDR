// artifacts/novel-reader/app.config.js
import { withGradleProperties } from "expo/config-plugins";

// Fixes EAS Android build failures where the Kotlin compiler worker for
// react-native-track-player dies with "Compilation error. See log for more
// details" and no actual diagnostic line printed above it. That pattern
// means the Kotlin daemon ran out of memory mid-compile on the build
// machine, not a real code error. Raising the Gradle/Kotlin daemon heap
// fixes it. This is a managed-workflow plugin, so it applies automatically
// during every EAS prebuild — no android/ folder needs to exist in the repo.
function withKotlinMemoryFix(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const upsert = (key, value) => {
      const existing = props.find(
        (p) => p.type === "property" && p.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: "property", key, value });
      }
    };

    upsert(
      "org.gradle.jvmargs",
      "-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError",
    );
    upsert("org.gradle.workers.max", "2");
    upsert("kotlin.daemon.jvm.options", "-Xmx3072m");

    return config;
  });
}

export default () => {
  const buildNumber = process.env.APP_BUILD_NUMBER || "1";

  return {
    expo: {
      name: "Novel DR",
      slug: "novel-reader",
      version: "3.10.25",
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
        infoPlist: {
          UIBackgroundModes: ["audio"],
        },
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
          "@sentry/react-native/expo",
          {
            organization: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
          },
        ],
        withKotlinMemoryFix,
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
