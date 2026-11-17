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
  "lightnovel.to",
  "novelbuddy.me",
  "centralnovel.com",
  "meionovels.com",
  "lightnovelworld.net",
  "novelasligera.com",
  "novelasligeras.net",
  // "wuxiabox.com",
  // "wuxia.click",
  // "mtlnovel.me",
];

// Sites whose Cloudflare check shows a "verify you are human" checkbox.
// A hidden WebView can't tap it, so for these hosts the bridge shows the
// WebView on screen when the challenge doesn't clear by itself, lets the
// person tap the checkbox, then hides it again. Cloudflare's clearance cookie
// is kept by the WebView, so later fetches usually pass without asking.
// Every host here must also be in WEBVIEW_HOSTS above.
const INTERACTIVE_CHALLENGE_HOSTS: readonly string[] = [
  "centralnovel.com",
  "meionovels.com",
  "lightnovelworld.net",
  "novelasligera.com",
  "novelasligeras.net",
];

/** True if this site may need the person to tap a Cloudflare checkbox. */
export const needsUserChallenge = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return INTERACTIVE_CHALLENGE_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
};

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

// Sites whose cover images sit behind a Cloudflare challenge. If the app
// can't download their cover, it shows the placeholder instead of a blank
// remote image.
const PROTECTED_COVER_HOSTS: readonly string[] = [
  "meionovels.com",
  "novelasligeras.net",
  "novelasligera.com",
  "lightnovelworld.net",
];

export const hasProtectedCover = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PROTECTED_COVER_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
};
