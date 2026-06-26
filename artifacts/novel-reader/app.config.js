// artifacts/novel-reader/app.config.js
export default () => {
  const buildNumber = process.env.APP_BUILD_NUMBER || '1';

  return {
    expo: {
      name: "Novel DR",
      slug: "novel-reader",
      version: "2.20.0",
      owner: "moggstones-stash",   // 🔧 Add this line
      orientation: "portrait",
      icon: "./assets/images/icon.png",
      scheme: "novel-reader",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      splash: {
        image: "./assets/images/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff"
      },
      ios: {
        supportsTablet: false,
        buildNumber: buildNumber
      },
      android: {
        package: "com.noveldr.app",
        versionCode: parseInt(buildNumber, 10)
      },
      web: {
        favicon: "./assets/images/icon.png"
      },
      plugins: [
        [
          "expo-router",
          {
            origin: "https://replit.com/"
          }
        ],
        "expo-font",
        "expo-web-browser"
      ],
      experiments: {
        typedRoutes: true,
        reactCompiler: true
      },
      extra: {
        eas: {
          projectId: "37b1e412-ff1c-47a2-993c-3b9e644f1770"
        }
      }
    }
  };
};
