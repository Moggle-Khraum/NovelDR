// hooks/scrapers/shared/urlSafety.ts
/**
 * Check whether an href (extracted from scraped HTML) is safe to navigate to.
 * Only accepts absolute URLs with http or https scheme, or relative URLs (no scheme).
 * Rejects javascript:, data:, vbscript:, file:, and other dangerous schemes.
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  // Strip ALL ASCII whitespace and control characters (0x00–0x20), not just
  // a leading run. Browsers strip embedded tab/newline characters from URLs
  // during parsing (per the WHATWG URL spec), so "java\tscript:alert(1)" is
  // actually interpreted as "javascript:alert(1)" — stripping only a
  // leading run would miss that and let it through as "no scheme".
  const cleaned = href.replace(/[\s\u0000-\u001F]+/g, "");
  if (!cleaned) return false;
  // Extract the scheme if present (e.g. "javascript:" -> scheme = "javascript")
  const schemeMatch = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    // Only http and https are safe
    return scheme === "http" || scheme === "https";
  }
  // No scheme means relative URL – safe
  return true;
}
