// hooks/scrapers/shared/coverFetch.ts
// Saves a cover image that a plain download couldn't get (Cloudflare blocks
// it), by fetching it from inside a WebView session that passed the challenge.

import * as FileSystem from "expo-file-system/legacy";
import { fetchImageViaWebView } from "./webviewBridge";

/**
 * Fetch `coverUrl` through the WebView and write it to `coverPath`.
 * Resolves with the saved file's URI. Throws if the image can't be fetched,
 * so the caller can fall back to the placeholder.
 */
export const saveCoverViaWebView = async (
  coverUrl: string,
  coverPath: string,
): Promise<string> => {
  const pageUrl = `${new URL(coverUrl).origin}/`;
  const base64 = await fetchImageViaWebView(pageUrl, coverUrl);
  if (!base64) throw new Error("empty image");

  const coverDir = coverPath.slice(0, coverPath.lastIndexOf("/") + 1);
  const dirInfo = await FileSystem.getInfoAsync(coverDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(coverDir, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(coverPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return coverPath;
};
