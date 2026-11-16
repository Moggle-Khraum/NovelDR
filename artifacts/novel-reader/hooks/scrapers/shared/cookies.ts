// Reads the cookies the WebView has stored for a URL (including Cloudflare's
// cf_clearance) so image downloads can send the same Cookie header the
// browser sent after passing the challenge. Returns "" when there are none
// or the cookie store can't be read, so callers can fall back safely.

import CookieManager from "@react-native-cookies/cookies";

export const getCookieHeader = async (url: string): Promise<string> => {
  try {
    const cookies = await CookieManager.get(url);
    return Object.entries(cookies)
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  } catch {
    return "";
  }
};
