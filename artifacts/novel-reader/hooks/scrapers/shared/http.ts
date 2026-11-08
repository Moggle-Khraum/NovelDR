// Generic HTTP helper for external scrapers: tries a direct fetch first,
// falls back to a CORS proxy if that fails. Self-contained — does not
// import the axios instance/headers from useDirectScraper.ts.

import axios from "axios";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/jpeg,image/jpg,image/png,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const httpClient = axios.create({
  timeout: 50000,
  headers: DEFAULT_HEADERS,
});

function validateFetchUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid scraper URL");
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Scraper URL must use HTTP(S) and must not contain credentials",
    );
  }

  return parsed.toString();
}

export interface FetchOptions {
  /** Force proxy first instead of direct-first (useful for sites that block direct fetches) */
  proxyFirst?: boolean;
  /** Proxy URL builder; defaults to corsproxy.io */
  buildProxyUrl?: (url: string) => string;
  /**
   * Final tier: if direct and proxy both fail, load the URL in the hidden
   * WebView bridge (a real browser context that can pass JS challenges).
   * Enabled by default; set to false to opt a call out.
   */
  webviewFallback?: boolean;
}

const defaultBuildProxyUrl = (url: string) =>
  `https://corsproxy.io/?${encodeURIComponent(url)}`;

// ── Tiered fetch ────────────────────────────────────────────────────────────
// direct -> proxy -> WebView. Each tier runs only after the previous one
// failed, never in parallel. The WebView tier is the heaviest, so it is
// skipped when a previous tier got a definitive "not found" (404/410):
// a real browser won't find a page that doesn't exist.

type Tier<T> = { name: string; run: () => Promise<T> };

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } })?.response?.status;

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const runTiers = async <T>(tiers: Tier<T>[]): Promise<T> => {
  const failures: string[] = [];
  let definitiveMiss = false;

  for (const tier of tiers) {
    if (tier.name === "webview" && definitiveMiss) {
      failures.push("webview: skipped (page not found)");
      continue;
    }
    try {
      return await tier.run();
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 || status === 410) definitiveMiss = true;
      failures.push(`${tier.name}: ${messageOf(err)}`);
    }
  }

  throw new Error(`All fetch tiers failed — ${failures.join(" | ")}`);
};

// Loaded lazily so Node-side tooling (scripts/test-scrapers.ts) that imports
// the scrapers doesn't pull react-native-webview in at module load.
const loadViaWebView = async (url: string, timeoutMs: number) => {
  const { fetchViaWebView } = await import("./webviewBridge");
  return fetchViaWebView(url, timeoutMs);
};

const WEBVIEW_TIMEOUT_MS = 35000;

export const looksLikeChallenge = (html: string): boolean =>
  /<title[^>]*>\\s*(?:just a moment|attention required|checking your browser)/i.test(
    html,
  ) ||
  /(?:cf-browser-verification|cf-chl-|challenge-platform|checking your browser)/i.test(
    html,
  );

const assertUsableHtml = (value: unknown, tier: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${tier} returned an empty or non-text response`);
  }
  if (looksLikeChallenge(value)) {
    throw new Error(`${tier} returned an anti-bot challenge page`);
  }
  return value;
};

// A browser shows a JSON response as <pre>{...}</pre>; pull the JSON back out.
const jsonFromWebViewHtml = <T>(html: string): T => {
  const match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const raw = (match ? match[1] : html.replace(/<[^>]+>/g, ""))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  return JSON.parse(raw) as T;
};

/**
 * Fetch a URL's HTML: direct, then proxy, then the WebView bridge (or proxy
 * first if proxyFirst is set). Each tier only runs after the previous one
 * failed. Throws, listing every tier's error, if all of them fail.
 */
export const fetchHtmlWithFallback = async (
  url: string,
  options: FetchOptions = {},
): Promise<string> => {
  const validatedUrl = validateFetchUrl(url);
  const buildProxyUrl = options.buildProxyUrl ?? defaultBuildProxyUrl;

  const direct: Tier<string> = {
    name: "direct",
    run: () =>
      httpClient
        .get(validatedUrl)
        .then((res) => assertUsableHtml(res.data, "direct fetch")),
  };
  const proxy: Tier<string> = {
    name: "proxy",
    run: () =>
      httpClient
        .get(buildProxyUrl(validatedUrl))
        .then((res) => assertUsableHtml(res.data, "proxy fetch")),
  };
  const webview: Tier<string> = {
    name: "webview",
    run: async () => {
      const html = await loadViaWebView(validatedUrl, WEBVIEW_TIMEOUT_MS);
      return assertUsableHtml(html, "WebView fetch");
    },
  };

  const tiers = options.proxyFirst ? [proxy, direct] : [direct, proxy];
  if (options.webviewFallback !== false) tiers.push(webview);
  return runTiers(tiers);
};

const JSON_HEADERS = {
  ...DEFAULT_HEADERS,
  Accept: "application/json",
};

/**
 * Fetch and parse a JSON endpoint: direct, then proxy, then the WebView
 * bridge (or proxy first if proxyFirst is set). Each tier only runs after
 * the previous one failed. Throws, listing every tier's error, if all fail.
 * Sibling to fetchHtmlWithFallback for API-based sources (e.g.
 * novelarchivecc.ts) rather than HTML-scraped ones.
 */
export const fetchJsonWithFallback = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const validatedUrl = validateFetchUrl(url);
  const buildProxyUrl = options.buildProxyUrl ?? defaultBuildProxyUrl;

  const direct: Tier<T> = {
    name: "direct",
    run: () =>
      httpClient
        .get(validatedUrl, { headers: JSON_HEADERS })
        .then((res) => res.data),
  };
  const proxy: Tier<T> = {
    name: "proxy",
    run: () =>
      httpClient
        .get(buildProxyUrl(validatedUrl), { headers: JSON_HEADERS })
        .then((res) => res.data),
  };
  const webview: Tier<T> = {
    name: "webview",
    run: async () =>
      jsonFromWebViewHtml<T>(
        await loadViaWebView(validatedUrl, WEBVIEW_TIMEOUT_MS),
      ),
  };

  const tiers = options.proxyFirst ? [proxy, direct] : [direct, proxy];
  if (options.webviewFallback !== false) tiers.push(webview);
  return runTiers(tiers);
};

export { httpClient };
