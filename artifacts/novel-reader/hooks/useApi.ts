import { directFetchNovelMeta, directFetchChapter } from "./useDirectScraper";
import { findExternalScraper } from "./scrapers/registry";
import { fetchViaWebView } from "./scrapers/shared/webviewBridge";

export type { NovelMeta, ChapterData } from "./useDirectScraper";

// Check the external scraper registry first; if a registered source
// claims the URL, use it. Otherwise fall through to the existing
// direct-scraper behavior, unchanged.
export const fetchNovelMeta: typeof directFetchNovelMeta = async (url) => {
  const external = findExternalScraper(url);
  if (external) return external.fetchNovelMeta(url);
  return directFetchNovelMeta(url);
};

export const fetchChapter: typeof directFetchChapter = async (
  url,
  chapterNum,
) => {
  const external = findExternalScraper(url);
  if (external) return external.fetchChapter(url, chapterNum);
  return directFetchChapter(url, chapterNum);
};

/**
 * AbortController.abort() is not reliable on Android/React Native for every
 * host (some connections, e.g. streaming/RSC sites, never actually tear down
 * the underlying OkHttp request even after the signal fires). That leaves the
 * awaited fetch stuck forever, which stalls the whole sequential health-check
 * loop in add.tsx for every site after it.
 *
 * This wraps a fetch attempt in a Promise.race against a hard JS-side timer
 * that always settles, regardless of whether the native abort worked. The
 * underlying fetch may still be dangling in the background, but the caller
 * is guaranteed to move on.
 */
const withHardTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Hard timeout after ${ms}ms: ${label}`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

const fetchWithBoundedTimeout = (
  url: string,
  init: RequestInit,
  softTimeoutMs: number,
  hardTimeoutMs: number,
  label: string,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), softTimeoutMs);

  const req = fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });

  // Hard timeout is always a bit longer than the soft (abort) timeout, so
  // abort gets a fair chance to work first, but we never wait past hardTimeoutMs.
  return withHardTimeout(req, hardTimeoutMs, label);
};

/**
 * Check if a site is healthy/accessible
 * Returns true if the site responds with any status code < 500
 * Uses a HEAD request first (faster), falls back to GET if needed, then a
 * CORS proxy retry (same one real scraping falls back to), and finally the
 * WebView bridge as the last resort - a real browser context that can pass
 * a JS challenge no plain HTTP request (direct or proxied) can get through.
 * This is the heaviest, slowest tier, so it's only reached after everything
 * else has already failed.
 *
 * Every attempt is bounded by a hard timeout (see withHardTimeout above) so
 * a single unresponsive host can never stall the health-check loop forever.
 */
// Health-check outcome classification, beyond a flat up/down:
// - "online"      - reachable and serving normally
// - "maintenance" - server responded 503 (the standard "temporarily
//                   unavailable, come back later" status) - the site is
//                   there, just intentionally not serving right now
// - "gateway_timeout" - 504 specifically - an upstream/proxy in front of
//                   the site timed out, distinct from the site itself
//                   being fully unreachable
// - "offline"     - every tier failed outright, or a non-503/504 5xx/error
export type SiteHealthState =
  | "online"
  | "maintenance"
  | "gateway_timeout"
  | "offline";

const classifyStatus = (status: number): SiteHealthState => {
  if (status === 503) return "maintenance";
  if (status === 504) return "gateway_timeout";
  if (status < 500) return "online";
  return "offline";
};

/**
 * Check if a site is healthy, escalating through progressively heavier
 * tiers (HEAD -> GET -> alternate paths -> CORS proxy -> WebView bridge)
 * until one succeeds or all are exhausted. Returns not just up/down but
 * the status code, response time, which tier answered, and a classified
 * state so "down", "under maintenance" (503), and "gateway timeout" (504)
 * can be told apart in the UI instead of all collapsing into one dot.
 */
export const checkSiteHealthDetailed = async (
  baseUrl: string,
): Promise<{
  isUp: boolean;
  state: SiteHealthState;
  statusCode?: number;
  responseTime?: number;
  tier?: string;
  error?: string;
}> => {
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  const cleanUrl = baseUrl.trim().replace(/\/+$/, "");

  const baseHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };

  // A 503/504 is meaningful even mid-escalation - if a site tells us
  // outright "I'm in maintenance" or "gateway timed out", that's more
  // useful information than continuing to hammer it with GET/proxy/WebView
  // tiers meant for sites that don't respond at all. Stop and report it.
  const isDefinitive = (status: number) => status === 503 || status === 504;

  try {
    // Try HEAD request first (faster, less data transfer)
    try {
      const response = await fetchWithBoundedTimeout(
        cleanUrl,
        { method: "HEAD", headers: baseHeaders, redirect: "follow" as any },
        10000, // soft (abort) timeout
        12000, // hard timeout - always wins even if abort doesn't work
        `HEAD ${cleanUrl}`,
      );

      if (response.status < 500 || isDefinitive(response.status)) {
        return {
          isUp: response.status < 500,
          state: classifyStatus(response.status),
          statusCode: response.status,
          responseTime: elapsed(),
          tier: "HEAD",
        };
      }
      // Other 5xx - server up but having issues; try a GET as fallback.
    } catch (error) {
      // HEAD failed or hard-timed-out, try GET
    }

    // Fallback to GET request if HEAD failed
    try {
      const response = await fetchWithBoundedTimeout(
        cleanUrl,
        {
          method: "GET",
          headers: { ...baseHeaders, "Cache-Control": "no-cache" },
          redirect: "follow" as any,
        },
        15000,
        17000,
        `GET ${cleanUrl}`,
      );

      if (response.status < 500 || isDefinitive(response.status)) {
        return {
          isUp: response.status < 500,
          state: classifyStatus(response.status),
          statusCode: response.status,
          responseTime: elapsed(),
          tier: "GET",
        };
      }
    } catch (error) {
      // GET also failed, fall through to path variants below
    }

    // Some sites block the root but allow specific paths
    const testPaths = ["/", "/novel", "/browse", "/books", "/fiction"];

    for (const path of testPaths) {
      try {
        const response = await fetchWithBoundedTimeout(
          `${cleanUrl}${path}`,
          { method: "GET", headers: baseHeaders, redirect: "follow" as any },
          10000,
          12000,
          `GET ${cleanUrl}${path}`,
        );

        if (response.status < 500 || isDefinitive(response.status)) {
          return {
            isUp: response.status < 500,
            state: classifyStatus(response.status),
            statusCode: response.status,
            responseTime: elapsed(),
            tier: `GET ${path}`,
          };
        }
      } catch (e) {
        // Continue to next path
        continue;
      }
    }

    // Last resort before WebView: retry via the same CORS proxy real
    // scraping falls back to. Handles sites that block a direct request
    // but don't specifically challenge proxied traffic.
    let proxyFailed = false;
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(cleanUrl)}`;
      const response = await fetchWithBoundedTimeout(
        proxyUrl,
        { method: "GET", headers: baseHeaders, redirect: "follow" as any },
        15000,
        17000,
        `PROXY GET ${cleanUrl}`,
      );

      if (response.status < 500 || isDefinitive(response.status)) {
        return {
          isUp: response.status < 500,
          state: classifyStatus(response.status),
          statusCode: response.status,
          responseTime: elapsed(),
          tier: "PROXY",
        };
      }
      proxyFailed = true;
    } catch (error) {
      proxyFailed = true;
    }

    // Absolute last resort: a real (hidden) browser context via the WebView
    // bridge. This is the only tier that can pass a JS challenge outright,
    // so it catches sites that block every plain HTTP attempt - direct or
    // proxied - but that the app can still actually reach when scraping,
    // since real scraping can fall back to this same bridge per-source.
    // Slow and heavy on purpose - only reached once everything else failed.
    if (proxyFailed) {
      try {
        const html = await fetchViaWebView(cleanUrl, 25000);
        // A real page is always more than a trivial stub; a challenge page
        // that never cleared would still resolve (the bridge always sends
        // something after its own poll timeout), so check for substance
        // rather than just "did it resolve".
        const isUp = typeof html === "string" && html.length > 500;
        return {
          isUp,
          state: isUp ? "online" : "offline",
          responseTime: elapsed(),
          tier: "WEBVIEW",
        };
      } catch (error: any) {
        return {
          isUp: false,
          state: "offline",
          responseTime: elapsed(),
          tier: "WEBVIEW",
          error: error?.message || "WebView check failed",
        };
      }
    }

    return { isUp: false, state: "offline", responseTime: elapsed() };
  } catch (error: any) {
    console.warn(`Health check failed for ${baseUrl}:`, error);
    return {
      isUp: false,
      state: "offline",
      responseTime: elapsed(),
      error: error?.message || "Unknown error",
    };
  }
};

// Thin boolean wrapper kept for any other callers that only care about
// up/down and don't need the state classification or diagnostics.
export const checkSiteHealth = async (baseUrl: string): Promise<boolean> => {
  const result = await checkSiteHealthDetailed(baseUrl);
  return result.isUp;
};
