// Headless-ish WebView bridge for scrapers that need a real browser context
// to pass a Cloudflare (or similar) JS challenge before the page's real HTML
// is available. A single invisible WebView, mounted once at the app root,
// processes one URL at a time from a queue and hands the final rendered
// document back to whichever scraper asked for it.
//
// Usage: fetchViaWebView(url) from anywhere — no need to know the bridge
// component exists. Requires <WebViewFetchBridge /> to be mounted somewhere
// in the tree (see app/_layout.tsx) or every call will reject immediately.
//
// This is meant to be an occasional fallback, not a default path — loading
// a real page and waiting out a JS challenge is much slower and heavier
// than a plain HTTP request. Gate its use per-source (see FetchOptions.
// webviewFallback in shared/http.ts) rather than calling it directly for
// every fetch.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

type PendingJob = {
  url: string;
  timeoutMs: number;
  resolve: (html: string) => void;
  reject: (err: Error) => void;
};

const queue: PendingJob[] = [];
let processNext: (() => void) | null = null;

/**
 * Fetch a URL's fully-rendered HTML via a hidden WebView instead of a plain
 * HTTP request. Use this only for sites that actively block non-browser
 * clients (Cloudflare challenge, etc.) — it's much slower and heavier than
 * a normal fetch, since it has to load a real page and wait for any JS
 * challenge to clear.
 *
 * Requires <WebViewFetchBridge /> to be mounted once, near the app root.
 * Rejects immediately (rather than hanging) if the bridge isn't mounted.
 */
export const fetchViaWebView = (url: string, timeoutMs = 25000): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!processNext) {
      reject(new Error('webview: WebViewFetchBridge is not mounted'));
      return;
    }
    queue.push({ url, timeoutMs, resolve, reject });
    processNext();
  });
};

// Injected once the WebView's initial page load finishes. Polls for the
// Cloudflare "Just a moment" interstitial to clear (real content in place
// of the challenge page), then posts the final document HTML back.
// Cloudflare challenges normally clear in 2-5s; this polls for up to ~12s
// before giving up and returning whatever is currently on the page — better
// to hand back a possibly-still-challenged page (the caller's own "could not
// locate content" checks will correctly catch that) than to hang forever.
const CHALLENGE_POLL_JS = `
(function () {
  var attempts = 0;
  var maxAttempts = 24; // 24 * 500ms = 12s
  function looksLikeChallenge() {
    var t = document.title || '';
    return /just a moment/i.test(t) ||
      !!document.querySelector('#challenge-running, .cf-browser-verification');
  }
  function send() {
    window.ReactNativeWebView.postMessage(document.documentElement.outerHTML);
  }
  function poll() {
    attempts++;
    if (!looksLikeChallenge() || attempts >= maxAttempts) {
      send();
      return;
    }
    setTimeout(poll, 500);
  }
  poll();
})();
true;
`;

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * Mount this once, near the app root (see app/_layout.tsx). Renders nothing
 * visible — the WebView is positioned off-screen with zero size — but must
 * stay mounted for fetchViaWebView() calls to resolve.
 */
export function WebViewFetchBridge() {
  const [current, setCurrent] = useState<PendingJob | null>(null);
  const currentRef = useRef<PendingJob | null>(null);
  const settledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((job: PendingJob, result: { html: string } | { error: Error }) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if ('html' in result) job.resolve(result.html);
    else job.reject(result.error);
    currentRef.current = null;
    setCurrent(null);
  }, []);

  const startNext = useCallback(() => {
    if (currentRef.current) return; // already busy with a job
    const job = queue.shift();
    if (!job) return;
    settledRef.current = false;
    currentRef.current = job;
    setCurrent(job);
    timeoutRef.current = setTimeout(() => {
      finish(job, { error: new Error(`webview: timed out loading ${job.url}`) });
      startNext();
    }, job.timeoutMs);
  }, [finish]);

  useEffect(() => {
    processNext = startNext;
    startNext(); // pick up anything queued before this mounted
    return () => {
      processNext = null;
    };
  }, [startNext]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const job = currentRef.current;
      if (!job) return;
      finish(job, { html: event.nativeEvent.data });
      startNext();
    },
    [finish, startNext]
  );

  const handleError = useCallback(() => {
    const job = currentRef.current;
    if (!job) return;
    finish(job, { error: new Error(`webview: failed to load ${job.url}`) });
    startNext();
  }, [finish, startNext]);

  if (!current) return null;

  return (
    <WebView
      source={{ uri: current.url }}
      style={styles.hidden}
      injectedJavaScript={CHALLENGE_POLL_JS}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleError}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
      userAgent={MOBILE_USER_AGENT}
    />
  );
}

const styles = StyleSheet.create({
  // Off-screen + zero-size rather than display:none — some WebView
  // implementations pause/never fire load events for display:none content.
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: -1000,
    left: -1000,
  },
});
