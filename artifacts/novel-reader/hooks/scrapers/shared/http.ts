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

export interface FetchOptions {
  /** Force proxy first instead of direct-first (useful for sites that block direct fetches) */
  proxyFirst?: boolean;
  /** Proxy URL builder; defaults to corsproxy.io */
  buildProxyUrl?: (url: string) => string;
}

const defaultBuildProxyUrl = (url: string) =>
  `https://corsproxy.io/?${encodeURIComponent(url)}`;

/**
 * Fetch a URL's HTML, trying direct first then falling back to a proxy
 * (or vice versa if proxyFirst is set). Throws if both attempts fail.
 */
export const fetchHtmlWithFallback = async (
  url: string,
  options: FetchOptions = {},
): Promise<string> => {
  const buildProxyUrl = options.buildProxyUrl ?? defaultBuildProxyUrl;

  const tryDirect = () => httpClient.get(url).then((res) => res.data);
  const tryProxy = () =>
    httpClient.get(buildProxyUrl(url)).then((res) => res.data);

  const [first, second] = options.proxyFirst
    ? [tryProxy, tryDirect]
    : [tryDirect, tryProxy];

  try {
    return await first();
  } catch (firstError) {
    return await second();
  }
};

const JSON_HEADERS = {
  ...DEFAULT_HEADERS,
  Accept: "application/json",
};

/**
 * Fetch and parse a JSON endpoint, trying direct first then falling back
 * to a proxy (or vice versa if proxyFirst is set). Throws if both
 * attempts fail. Sibling to fetchHtmlWithFallback for API-based sources
 * (e.g. novelarchivecc.ts) rather than HTML-scraped ones.
 */
export const fetchJsonWithFallback = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const buildProxyUrl = options.buildProxyUrl ?? defaultBuildProxyUrl;

  const tryDirect = () =>
    httpClient.get(url, { headers: JSON_HEADERS }).then((res) => res.data);
  const tryProxy = () =>
    httpClient
      .get(buildProxyUrl(url), { headers: JSON_HEADERS })
      .then((res) => res.data);

  const [first, second] = options.proxyFirst
    ? [tryProxy, tryDirect]
    : [tryDirect, tryProxy];

  try {
    return await first();
  } catch (firstError) {
    return await second();
  }
};

export { httpClient };
