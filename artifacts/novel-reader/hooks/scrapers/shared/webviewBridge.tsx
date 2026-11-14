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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import {
  WebView as RNWebView,
  WebViewMessageEvent,
  WebViewProps,
} from "react-native-webview";

// react-native-webview's published root index.d.ts declares
// `class WebView<P = undefined> extends Component<WebViewProps & P>`. JSX can't
// infer `P` from usage, so it defaults to `undefined`, and `WebViewProps & undefined`
// collapses to `never` — rejecting every prop passed to <WebView />. This is a known
// typing bug in the package itself (the correct functional-component declaration
// lives at `lib/WebView.d.ts`, but plain Node module resolution picks up the root
// `index.d.ts` instead). Casting to a plain component type sidesteps it without
// touching runtime behavior — `RNWebView` is still the real thing underneath, and
// still what `useRef<RNWebView>` below tracks for the instance/ref type.
const WebView = RNWebView as unknown as React.ComponentType<
  WebViewProps & React.RefAttributes<RNWebView>
>;

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
export const fetchViaWebView = (
  url: string,
  timeoutMs = 30000,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!processNext) {
      reject(new Error("webview: WebViewFetchBridge is not mounted"));
      return;
    }
    queue.push({ url, timeoutMs, resolve, reject });
    processNext();
  });
};

// How the page is judged "ready". The goal is to hand HTML back about as
// fast as a plain fetch would once the real page exists, instead of waiting
// out a fixed delay.
const POLL_INTERVAL_MS = 150;
// Poll results that must agree (DOM size unchanged) before sending.
const SETTLE_POLLS = 2;
// Last-resort send of whatever is there. Kept under the job's hard timeout
// (30s by default) so the page content wins the race instead of an error.
const POLL_DEADLINE_MS = 25000;
// Pages with fewer characters than this are error stubs, not real content.
const MIN_REAL_PAGE_CHARS = 1500;

// Runs inside the page. Sends the document once it is a real page:
// - a JSON response, a Next.js RSC payload, or a NovelArrow reading element
//   is final immediately;
// - any other page is sent once it is past the JS challenge, its DOM has
//   loaded, and its size has stopped changing.
// A Cloudflare challenge page is never sent early. The guard flag keeps the
// two injections (before load and onLoadEnd) from running two pollers, which
// could post the same page twice and hand it to the next queued job.
const CHALLENGE_POLL_JS = `
(function () {
  if (window.__noveldrPoll) return;
  window.__noveldrPoll = true;

  var startedAt = Date.now();
  var lastSize = -1;
  var stableCount = 0;

  function isFinalMarker() {
    // A JSON API response (no challenge in front of it) is already final
    if (/json/i.test(document.contentType || '')) return true;
    // Next.js RSC payload – a solid marker
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].textContent && scripts[i].textContent.includes('self.__next_f.push')) {
        return true;
      }
    }
    // Known content elements on NovelArrow
    if (document.querySelector('article[data-chapter-id]')) return true;
    if (document.querySelector('.site-reading-copy')) return true;
    return false;
  }

  function isStillChallenge() {
    var t = document.title || '';
    if (/just a moment|attention required|verify you are human|checking your browser/i.test(t)) return true;
    if (document.querySelector('#challenge-running, #challenge-form, #cf-challenge-running, .cf-browser-verification')) return true;
    // Only defined on the interstitial; ordinary pages carry a different
    // passive Cloudflare script that does not set this.
    if (window._cf_chl_opt) return true;
    return false;
  }

  function send() {
    window.ReactNativeWebView.postMessage(document.documentElement.outerHTML);
  }

  function poll() {
    if (isFinalMarker()) { send(); return; }

    if (!isStillChallenge() && document.readyState !== 'loading' && document.body) {
      var size = document.body.getElementsByTagName('*').length;
      stableCount = size === lastSize ? stableCount + 1 : 0;
      lastSize = size;
      if (stableCount >= ${SETTLE_POLLS - 1} &&
          document.documentElement.outerHTML.length >= ${MIN_REAL_PAGE_CHARS}) {
        send();
        return;
      }
    } else {
      stableCount = 0;
      lastSize = -1;
    }

    if (Date.now() - startedAt >= ${POLL_DEADLINE_MS}) { send(); return; }
    setTimeout(poll, ${POLL_INTERVAL_MS});
  }

  setTimeout(poll, ${POLL_INTERVAL_MS});
})();
true;
`;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  const webViewRef = useRef<RNWebView>(null);

  const finish = useCallback(
    (job: PendingJob, result: { html: string } | { error: Error }) => {
      if (settledRef.current) return;
      settledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if ("html" in result) job.resolve(result.html);
      else job.reject(result.error);
      currentRef.current = null;
      setCurrent(null);
    },
    [],
  );

  const startNext = useCallback(() => {
    if (currentRef.current) return; // already busy with a job
    const job = queue.shift();
    if (!job) return;
    settledRef.current = false;
    currentRef.current = job;
    setCurrent(job);
    timeoutRef.current = setTimeout(() => {
      finish(job, {
        error: new Error(`webview: timed out loading ${job.url}`),
      });
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
    [finish, startNext],
  );

  const handleError = useCallback(() => {
    const job = currentRef.current;
    if (!job) return;
    finish(job, { error: new Error(`webview: failed to load ${job.url}`) });
    startNext();
  }, [finish, startNext]);

  // Re‑inject the polling script after every successful navigation
  const onLoadEnd = useCallback(() => {
    webViewRef.current?.injectJavaScript(CHALLENGE_POLL_JS);
  }, []);

  if (!current) return null;

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: current.url }}
      style={styles.hidden}
      // react-native-webview wraps the WebView in a flex:1 View; without this
      // the wrapper takes half the screen next to the app while a job runs.
      containerStyle={styles.hidden}
      onLoadEnd={onLoadEnd}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleError}
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled={true}
      cacheEnabled={false}
      // Only web URLs are needed for scraper pages; block file/data/javascript schemes.
      originWhitelist={["https://*", "http://*"]}
      onShouldStartLoadWithRequest={(request) => {
        try {
          const protocol = new URL(request.url).protocol;
          return protocol === "https:" || protocol === "http:";
        } catch {
          return false;
        }
      }}
      userAgent={DESKTOP_USER_AGENT}
      injectedJavaScriptBeforeContentLoaded={CHALLENGE_POLL_JS}
    />
  );
}

const styles = StyleSheet.create({
  // Off-screen + zero-size rather than display:none — some WebView
  // implementations pause/never fire load events for display:none content.
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    top: -1000,
    left: -1000,
  },
});
