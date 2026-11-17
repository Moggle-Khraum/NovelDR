// Low Memory Mode pauses Cloudflare sites. This asks before one job from a
// paused site is allowed to use the WebView.
import { Alert } from "react-native";
import {
  grantPausedSiteException,
  isLowMemoryActive,
} from "@/hooks/scrapers/shared/lowMemoryState";
import { needsWebView } from "@/hooks/scrapers/shared/webviewSites";

/** True when Low Memory Mode has paused this URL's site. */
export const isPausedSiteUrl = (url: string): boolean =>
  isLowMemoryActive() && needsWebView(url);

/**
 * Resolves true if the person continues. Continue lifts the pause for the
 * current job only. The caller must call endPausedSiteException() when the
 * job ends.
 */
export const confirmPausedSiteJob = (siteName: string): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      `${siteName} is paused`,
      "Low Memory Mode pauses sites that need the hidden browser (WebView), because it uses a lot of memory on this device.\n\n" +
        "Continue to use it for this job only. Background site checks stay off until it finishes. " +
        "The job can slow the device or crash the app. You can halt at any time.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Continue",
          onPress: () => {
            grantPausedSiteException();
            resolve(true);
          },
        },
      ],
      { cancelable: false },
    );
  });
