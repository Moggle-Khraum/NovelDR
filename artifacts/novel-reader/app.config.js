// artifacts/novel-reader/app.config.js
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
      },
      android: {
        package: "com.noveldr.app",
        versionCode: parseInt(buildNumber, 10),
        permissions: ["REQUEST_INSTALL_PACKAGES", "POST_NOTIFICATIONS"],
      },
      web: {
        favicon: "./assets/images/icon.png",
      },
      plugins: [
        "./plugins/withGradle810",
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
        [
          "expo-build-properties",
          {
            android: {
              compileSdkVersion: 34,
            },
          },
        ],
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
