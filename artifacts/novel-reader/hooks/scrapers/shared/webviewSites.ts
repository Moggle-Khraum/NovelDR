// Sites that are allowed to use the hidden WebView tier.
//
// The WebView is the slowest, heaviest fetch tier, so it is opt-in per site:
// everything else stays on direct -> CORS proxy only. A listed site still
// tries direct and proxy first; the WebView only runs if both of those fail.
//
// Remove a host from this list if it turns out to work without the WebView.
// Cloudflare-fronted but NOT confirmed - uncomment one if it starts failing
// with "All fetch tiers failed":
//   wuxiabox.com, wuxia.click (also matches old.wuxia.click), mtlnovel.me
const WEBVIEW_HOSTS: readonly string[] = [
  "royalroad.com",
  "novelping.com",
  "fanmtl.com",
  "freewebnovel.com",
  "freewebnovel.org",
  "novgo.net",
  "wuxiaworld.site",
  "novelphoenix.com",
  "novelbin.cc",
  // "wuxiabox.com",
  // "wuxia.click",
  // "mtlnovel.me",
];

/**
 * True if this URL's site may fall back to the WebView. Matches the host
 * itself or any subdomain of it (www., etc.), the same way the scrapers'
 * own canHandle() checks do.
 */
export const needsWebView = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return WEBVIEW_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
};
