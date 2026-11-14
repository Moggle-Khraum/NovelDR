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
}

const defaultBuildProxyUrl = (url: string) =>
  `https://corsproxy.io/?${encodeURIComponent(url)}`;

// ── Tiered fetch ────────────────────────────────────────────────────────────
// direct -> proxy. Each tier runs only after the previous one failed, never
// in parallel.

type Tier<T> = { name: string; run: () => Promise<T> };

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const runTiers = async <T>(tiers: Tier<T>[]): Promise<T> => {
  const failures: string[] = [];

  for (const tier of tiers) {
    try {
      return await tier.run();
    } catch (err) {
      failures.push(`${tier.name}: ${messageOf(err)}`);
    }
  }

  throw new Error(`All fetch tiers failed — ${failures.join(" | ")}`);
};

export const looksLikeChallenge = (html: string): boolean =>
  /<title[^>]*>\s*(?:just a moment|attention required|checking your browser)/i.test(
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

/**
 * Fetch a URL's HTML: direct, then proxy (or proxy first if proxyFirst is
 * set). Each tier only runs after the previous one failed. Throws, listing
 * every tier's error, if both fail.
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

  const tiers = options.proxyFirst ? [proxy, direct] : [direct, proxy];
  return runTiers(tiers);
};

const JSON_HEADERS = {
  ...DEFAULT_HEADERS,
  Accept: "application/json",
};

/**
 * Fetch and parse a JSON endpoint: direct, then proxy (or proxy first if
 * proxyFirst is set). Each tier only runs after the previous one failed.
 * Throws, listing every tier's error, if both fail.
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

  const tiers = options.proxyFirst ? [proxy, direct] : [direct, proxy];
  return runTiers(tiers);
};

export { httpClient };
