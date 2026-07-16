// Generic HTTP helper for external scrapers: tries a direct fetch first,
// falls back to a CORS proxy if that fails, and (opt-in per source) falls
// back further to a hidden WebView for sites that run a JS bot-challenge
// (Cloudflare, etc.) that neither a direct request nor a plain proxy can
// clear. Self-contained — does not import the axios instance/headers from
// useDirectScraper.ts.

import axios from 'axios';
import { fetchViaWebView } from './webviewBridge';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/jpeg,image/jpg,image/png,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const httpClient = axios.create({
  timeout: 15000,
  headers: DEFAULT_HEADERS,
});

export interface FetchOptions {
  /** Force proxy first instead of direct-first (useful for sites that block direct fetches) */
  proxyFirst?: boolean;
  /** Proxy URL builder; defaults to corsproxy.io */
  buildProxyUrl?: (url: string) => string;
  /**
   * If direct + proxy both fail, fall back to loading the page in a hidden
   * WebView (see shared/webviewBridge.tsx) so a real JS challenge (e.g.
   * Cloudflare's "Just a moment") can actually run and clear. Off by
   * default — this is much slower than a plain HTTP request, so only turn
   * it on for sources known to need it.
   */
  webviewFallback?: boolean;
  /** Timeout for the WebView fallback attempt, in ms. Default 25000. */
  webviewTimeoutMs?: number;
}

const defaultBuildProxyUrl = (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`;

/**
 * Fetch a URL's HTML, trying direct first then falling back to a proxy
 * (or vice versa if proxyFirst is set), and finally — if webviewFallback is
 * set and both of those fail — a hidden WebView. Throws if every attempt
 * that was tried fails.
 */
export const fetchHtmlWithFallback = async (
  url: string,
  options: FetchOptions = {},
): Promise<string> => {
  const buildProxyUrl = options.buildProxyUrl ?? defaultBuildProxyUrl;

  const tryDirect = () => httpClient.get(url).then((res) => res.data);
  const tryProxy = () => httpClient.get(buildProxyUrl(url)).then((res) => res.data);

  const [first, second] = options.proxyFirst ? [tryProxy, tryDirect] : [tryDirect, tryProxy];

  try {
    return await first();
  } catch (firstError) {
    try {
      return await second();
    } catch (secondError) {
      if (!options.webviewFallback) throw secondError;

      try {
        return await fetchViaWebView(url, options.webviewTimeoutMs);
      } catch (webviewError) {
        // The HTTP error (status code, etc.) is usually more informative
        // than the WebView's generic failure — surface both so logs show
        // that the WebView fallback was tried and why it also failed.
        const httpMessage =
          secondError instanceof Error ? secondError.message : String(secondError);
        const webviewMessage =
          webviewError instanceof Error ? webviewError.message : String(webviewError);
        throw new Error(`${httpMessage}. WebView fallback also failed: ${webviewMessage}`);
      }
    }
  }
};

export { httpClient };

