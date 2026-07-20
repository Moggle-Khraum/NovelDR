// plugins/withGradle810.js
// Pins Gradle wrapper to 8.10.2 to avoid the AGP 8.5+ breakage in
// expo-notifications 0.27.x (components.release / compileSdk bug).
// CJS so it works regardless of the app.config.js module format.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      const wrapperPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "gradle/wrapper/gradle-wrapper.properties",
      );
      if (fs.existsSync(wrapperPath)) {
        let contents = fs.readFileSync(wrapperPath, "utf8");
        contents = contents.replace(
          /distributionUrl=.+/,
          "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip",
        );
        fs.writeFileSync(wrapperPath, contents);
      }
      return cfg;
    },
  ]);
