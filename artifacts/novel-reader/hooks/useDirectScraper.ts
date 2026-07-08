import axios from 'axios';
import { decodeHTML } from 'entities';

export interface NovelMeta {
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string;
  firstChapterUrl: string | null;
  debugInfo?: string[];
}

export interface ChapterListItem {
  number: number;
  title: string;
  url: string;
}

export interface ChapterData {
  url: string;
  title: string;
  content: string;
  nextUrl: string | null;
  scraperInfo?: {
    selector: 'chapterText' | 'chapter-text' | 'generic-fallback';
    rawCount: number;
    filteredCount: number;
    htmlLength: number;
    pTagCount: number;
    fetchMethod: 'fetch' | 'fetch-proxy';
    httpStatus: number;
    jsInjected: boolean;
    chapterTextCount: number;
    contentType: string;
  };
}

// Helper: Strip HTML tags safely
const stripTags = (html: string): string => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

// Helper: Decode HTML entities safely
const decodeEntities = (text: string): string => {
  if (!text) return '';
  try {
    return decodeHTML(text);
  } catch {
    return text;
  }
};

// Safe regex match with fallback
const safeMatch = (text: string, pattern: RegExp): string | null => {
  if (!text) return null;
  try {
    const match = text.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

// Extract title from URL
const extractTitleFromUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    let path = parsedUrl.pathname;
    if (path.endsWith('.html')) path = path.slice(0, -5);
    const pathParts = path.split('/').filter(part => part);
    let novelSlug = null;
    for (const part of pathParts) {
      if (part && !part.toLowerCase().includes('chapter') && part.length > 5) {
        novelSlug = part;
        break;
      }
    }
    if (!novelSlug && pathParts.length > 0) {
      novelSlug = pathParts[pathParts.length - 1];
    }
    if (novelSlug) {
      novelSlug = novelSlug.replace(/^\d+[\s\-\.]+/, '');
      const title = novelSlug.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
      return title.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
    return 'Unknown Novel';
  } catch {
    return 'Unknown Novel';
  }
};

const makeAbsoluteUrl = (relativeUrl: string, baseUrl: string): string => {
  if (!relativeUrl) return baseUrl;
  if (relativeUrl.startsWith('http')) return relativeUrl;
  if (relativeUrl.startsWith('/')) {
    try {
      const parsed = new URL(baseUrl);
      return `${parsed.protocol}//${parsed.host}${relativeUrl}`;
    } catch {
      return relativeUrl;
    }
  }
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
};

// Create axios instance
const httpClient = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/jpeg,image/jpg,image/png,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  },
});

// LNW-specific fetch
interface LnwFetchResult {
  html: string;
  fetchMethod: 'fetch' | 'fetch-proxy';
  httpStatus: number;
  contentType: string;
}

const fetchLightNovelWorld = async (url: string): Promise<LnwFetchResult> => {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
  };

  try {
    const response = await fetch(url, { headers });
    const html = await response.text();
    const chapterTextCount = (html.match(/id="chapterText"/g) || []).length;
    const pTagCount = (html.match(/<p[\s>]/gi) || []).length;
    console.log(`[LNW] Raw HTML: ${html.length} chars, #chapterText: ${chapterTextCount}, <p> tags: ${pTagCount}`);
    return {
      html,
      fetchMethod: 'fetch',
      httpStatus: response.status,
      contentType: response.headers.get('content-type') || 'unknown',
    };
  } catch (err: any) {
    console.warn('[LNW] Direct fetch failed, trying proxy:', err.message);
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { headers });
    if (!proxyRes.ok) throw new Error(`Proxy HTTP ${proxyRes.status}`);
    const html = await proxyRes.text();
    return {
      html,
      fetchMethod: 'fetch-proxy',
      httpStatus: proxyRes.status,
      contentType: proxyRes.headers.get('content-type') || 'unknown',
    };
  }
};

// ─── ASIANOVEL.NET — fully isolated HTTP client ─────────────────────────────
// This axios instance is used ONLY for asianovel.net requests. It is
// completely separate from the shared `httpClient` above so that anything
// tuned here (headers, decompression behavior, timeouts) can never affect
// FreeWebNovel, LightNovelWorld, or any other site.
//
// NOTE: deliberately does NOT set 'Accept-Encoding'. On Android, React
// Native's networking layer (OkHttp) only auto-decompresses gzip/br
// responses when it sets that header itself. Setting it manually disables
// transparent decompression, so the server's compressed bytes come back
// undecoded — raw gzip/brotli binary shoved into a JS string instead of
// readable HTML (mojibake). This was the root cause of Asianovel scraping
// returning garbage/empty results.
const asianovelHttpClient = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  },
});

// Special fetch for Asianovel — routed entirely through asianovelHttpClient above
const fetchAsianovel = async (url: string): Promise<string> => {
  console.log('[Scraper] Fetching Asianovel via isolated client...');

  try {
    const response = await asianovelHttpClient.get(url);
    return response.data;
  } catch (error: any) {
    console.warn('[Scraper] Asianovel direct fetch failed:', error.message);
    try {
      // Native fetch as a secondary attempt, still without a manual
      // Accept-Encoding header for the same decompression reason above.
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      return await response.text();
    } catch (fetchError: any) {
      console.warn('[Scraper] Asianovel fetch API failed:', fetchError.message);
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const proxyResponse = await asianovelHttpClient.get(proxyUrl);
      return proxyResponse.data;
    }
  }
};

// Fetch with fallback
const fetchWithFallback = async (url: string, isFreeWebNovel: boolean, isAsianovel: boolean = false): Promise<string> => {
  if (isAsianovel) {
    return await fetchAsianovel(url);
  }
  if (isFreeWebNovel) {
    console.log('[Scraper] FreeWebNovel - using proxy for HTTP/1.1');
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    try {
      const response = await httpClient.get(proxyUrl);
      return response.data;
    } catch (proxyError: any) {
      console.warn('[Scraper] Proxy failed, trying direct:', proxyError.message);
      const directResponse = await httpClient.get(url);
      return directResponse.data;
    }
  }
  try {
    const response = await httpClient.get(url);
    return response.data;
  } catch (directError: any) {
    console.warn('[Scraper] Direct fetch failed, trying proxy:', directError.message);
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const proxyResponse = await httpClient.get(proxyUrl);
    return proxyResponse.data;
  }
};

// ─── LightNovelWorld: div‑depth content extractor ────────────────────────────
const lnwExtractInnerHtml = (html: string): string | null => {
  const primaryMarker = 'id="chapterText"';
  let start = html.indexOf(primaryMarker);
  let usedFallback = false;

  if (start === -1) {
    start = html.indexOf('class="chapter-text');
    if (start === -1) return null;
    usedFallback = true;
    console.log('[LNW] Fallback selector (.chapter-text) matched');
  } else {
    console.log('[LNW] Primary selector (#chapterText) matched');
  }

  const openTagEnd = html.indexOf('>', start);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let i = openTagEnd + 1;

  while (i < html.length && depth > 0) {
    const nextOpen  = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      i = nextClose + 5;
    }
  }

  let inner = html.slice(openTagEnd + 1, i);

  const removeNestedDivByClass = (source: string, classFragment: string): string => {
    let output = source;
    let searchFrom = 0;
    while (true) {
      const classIndex = output.indexOf(classFragment, searchFrom);
      if (classIndex === -1) break;
      const tagStart = output.lastIndexOf('<div', classIndex);
      const tagEnd = output.indexOf('>', classIndex);
      if (tagStart === -1 || tagEnd === -1) {
        searchFrom = classIndex + classFragment.length;
        continue;
      }
      let divDepth = 1;
      let cursor = tagEnd + 1;
      while (cursor < output.length && divDepth > 0) {
        const nextOpen = output.indexOf('<div', cursor);
        const nextClose = output.indexOf('</div', cursor);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          divDepth++;
          cursor = nextOpen + 4;
        } else {
          divDepth--;
          cursor = nextClose + 5;
        }
      }
      output = output.slice(0, tagStart) + output.slice(cursor);
      searchFrom = tagStart;
    }
    return output;
  };

  inner = removeNestedDivByClass(inner, 'chapter-ad-container');
  inner = inner.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  inner = inner.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  return inner;
};

// ─── ASIANOVEL.NET: quote-aware, depth-counting content extractor ──────────
// Fictioneer's Stimulus.js markup uses attributes like
// data-action="mousedown->fictioneer-chapter#fastClick", which contain a
// literal '>' character INSIDE the quotes. Naive regex tag-matching (e.g.
// [^>]*>) stops at that embedded '>' instead of the tag's real closing
// bracket, truncating the match early. This scans character-by-character,
// tracking whether we're inside a quoted attribute value, to find the true
// end of the opening tag.
const findRealTagEnd = (html: string, fromIdx: number): number => {
  let i = fromIdx;
  let quoteChar: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = null;
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
    } else if (ch === '>') {
      return i;
    }
    i++;
  }
  return -1;
};

// The real chapter text sits inside <section id="chapter-content">...</section>.
// That section also contains ad <div> wrappers (top and bottom) BEFORE/AFTER
// the actual <p> paragraphs — a naive non-greedy </div> or </section> match
// would stop at the first nested closing tag and miss most (or all) of the
// real content. Since there is never a nested <section> inside it, depth-
// counting on <section>/</section> gives us the true, complete boundary.
const extractAsianovelChapterContentHtml = (html: string): string | null => {
  const marker = 'id="chapter-content"';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const tagStart = html.lastIndexOf('<', markerIdx);
  if (tagStart === -1) return null;

  const openTagEnd = findRealTagEnd(html, tagStart);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let i = openTagEnd + 1;
  let contentEnd = -1;

  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<section', i);
    const nextClose = html.indexOf('</section', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 8; // length of '<section'
    } else {
      depth--;
      if (depth === 0) contentEnd = nextClose;
      i = nextClose + 9; // length of '</section'
    }
  }

  if (contentEnd === -1) return null;
  return html.slice(openTagEnd + 1, contentEnd);
};

const lnwExtractParagraphs = (html: string): {
  paragraphs: string[];
  selector: 'chapterText' | 'chapter-text' | 'generic-fallback';
} => {
  const inner = lnwExtractInnerHtml(html);
  if (inner) {
    const rawParas = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1]);
    if (rawParas.length > 0) {
      const usedFallbackClass = html.indexOf('id="chapterText"') === -1;
      const selector = usedFallbackClass ? 'chapter-text' : 'chapterText';
      console.log(`[LNW] Found ${rawParas.length} <p> paragraphs via #${selector}`);
      return { paragraphs: rawParas, selector };
    }
  }
  console.warn('[LNW] #chapterText extraction failed — falling through to generic <p> scan');
  const fallback = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1]);
  console.log(`[LNW] Generic scan — ${fallback.length} raw paragraphs`);
  return { paragraphs: fallback, selector: 'generic-fallback' };
};

const LNW_JUNK_PHRASES = [
  'text-to-speech is here',
  'create a free account',
  'unlock the full experience',
  'post comment',
  'verification code',
  'resend code',
  'staff account detected',
  'forgot password',
  'reset password',
  'light novel world',
  'your gateway to infinite stories',
  'loading chapters',
  'chapter comments',
  'login to comment',
  'please follow common sense',
  'spam, phishing',
];

const lnwFilterParagraphs = (rawParas: string[]): string[] => {
  const results: string[] = [];
  for (const p of rawParas) {
    const text = decodeEntities(stripTags(p)).trim();
    const lower = text.toLowerCase();
    if (text.length < 20) continue;
    if (LNW_JUNK_PHRASES.some(phrase => lower.includes(phrase))) continue;
    results.push(text);
  }
  const deduped: string[] = [];
  for (const p of results) {
    if (deduped.length === 0 || p !== deduped[deduped.length - 1]) {
      deduped.push(p);
    }
  }
  return deduped;
};

// ─── Synopsis cleaning – remove the exact boilerplate line ──────────────────
const cleanSynopsis = (text: string): string => {
  if (!text) return '';

  let cleaned = text;

  // The boilerplate is usually split across multiple lines/elements, e.g.:
  //   You're reading
  //   "Novel Title"
  //   on Wuxiaworld.Site
  // Same-line matching alone misses this. Instead, match the whole sequence
  // as a block — "you're/you are reading" ... (any quoted title in between,
  // within a reasonable distance) ... "on wuxiaworld[.site]" — and delete it
  // in one shot, however it's broken up by newlines/whitespace.
  cleaned = cleaned.replace(
    /you\s*'?\s*re\s+reading[\s\S]{0,150}?on\s*wuxiaworld(?:\.?site)?/gi,
    ''
  );
  cleaned = cleaned.replace(
    /you\s+are\s+reading[\s\S]{0,150}?on\s*wuxiaworld(?:\.?site)?/gi,
    ''
  );

  // Split into lines for anything that survived as isolated fragments
  const lines = cleaned.split(/\n/);

  const filteredLines = lines.filter(line => {
    const lower = line.toLowerCase().trim();
    if (!lower) return true; // keep blank lines, collapsed later

    // Leftover "You're reading" fragment on its own line
    if (/^you\s*'?\s*re\s+reading\s*:?\s*$/.test(lower)) return false;
    if (/^you\s+are\s+reading\s*:?\s*$/.test(lower)) return false;

    // Leftover "on Wuxiaworld[.site]" fragment on its own line
    if (/^on\s*wuxiaworld(?:\.?site)?\s*$/.test(lower)) return false;

    // A line that is ONLY a quoted string with nothing else (the orphaned
    // novel title left behind once "reading"/"on wuxiaworld" are stripped
    // from around it) — safe to drop since real synopsis sentences don't
    // consist of just a bare quoted phrase with no other words.
    if (/^["“][^"”]+["”]\s*$/.test(line.trim())) return false;

    return true;
  });

  cleaned = filteredLines.join('\n');

  // Catch-all: remove any remaining bare mentions of the site name
  cleaned = cleaned.replace(/wuxiaworld\.?site/gi, '');

  // Clean extra whitespace and normalize spacing
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();

  // WuxiaWorld's synopsis HTML puts a <br> between nearly every sentence
  // rather than using real paragraph breaks, so at this point `cleaned` is
  // usually one long, unbroken block of prose. Left as-is, the app's
  // truncation/"See More" preview has nowhere natural to cut, and shows a
  // single dense wall of text instead of a nicely readable preview (unlike
  // AsiaNovel, whose real <p> tags already give proper paragraph breaks).
  // This regroups the flat sentence stream into readable pseudo-paragraphs —
  // every 2–3 sentences, or sooner after a short one (typically dialogue) —
  // purely for display/truncation purposes. It doesn't change any wording.
  cleaned = groupSentencesIntoParagraphs(cleaned);

  return cleaned || text; // fallback to original if empty
};

// Regroups a flat block of prose into paragraph-sized chunks (2–3 sentences
// each, breaking early after a short sentence) purely for readability and
// so preview/truncation UIs have natural break points. Leaves the actual
// wording untouched — this only inserts blank lines between groups.
const groupSentencesIntoParagraphs = (text: string): string => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:['"”’]\s*)?/g);
  if (!sentences || sentences.length <= 1) return text;

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];
  let sentenceCount = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    currentParagraph.push(trimmed);
    sentenceCount++;

    // Start a new paragraph after 2-3 sentences, or sooner if this sentence
    // was short (typically a line of dialogue or a quick beat).
    if (sentenceCount >= 3 || trimmed.length < 50) {
      paragraphs.push(currentParagraph.join(' '));
      currentParagraph = [];
      sentenceCount = 0;
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }

  return paragraphs.join('\n\n');
};

// ─── Main exports ──────────────────────────────────────────────────────────────
export const directFetchNovelMeta = async (url: string): Promise<NovelMeta> => {
  console.log('[Scraper] Fetching novel meta from:', url);
  
  try {
    const domainLower = url.toLowerCase();
    const isReadNovelFull = domainLower.includes('readnovelfull');
    const isNovelFullNet = domainLower.includes('novelfull.net') && !isReadNovelFull;
    const isNovelFullCom = domainLower.includes('novelfull.com');
    const isAllNovel = domainLower.includes('allnovel.org');
    const isNovgo = domainLower.includes('novgo.net');
    const isFreeWebNovel = domainLower.includes('freewebnovel');
    const isLightNovelWorld = domainLower.includes('lightnovelworld');
    const isRoyalRoad = domainLower.includes('royalroad.com');
    const isWuxiaworld = domainLower.includes('wuxiaworld.site');
    const isAsianovel = domainLower.includes('asianovel.net');
    
    const html = await fetchWithFallback(url, isFreeWebNovel, isAsianovel);
    
    const asianovelDebug: string[] = [];
    if (isAsianovel) {
      const bodyIdx = html.indexOf('<body');
      asianovelDebug.push(`html length: ${html.length}`);
      asianovelDebug.push(`has chapter-group__list: ${html.includes('chapter-group__list')}`);
      asianovelDebug.push(`has story__identity-title: ${html.includes('story__identity-title')}`);
      asianovelDebug.push(`has story__thumbnail: ${html.includes('story__thumbnail')}`);
      asianovelDebug.push(
        `<body> snippet: ${bodyIdx >= 0 ? html.slice(bodyIdx, bodyIdx + 300) : '(no <body> tag found)'}`
      );
      asianovelDebug.push(`raw start: ${html.slice(0, 300)}`);
      asianovelDebug.forEach(line => console.log('[DEBUG][Asianovel]', line));
    }
    
    let title = extractTitleFromUrl(url);
    let author = 'Unknown Author';
    let synopsis = 'No summary available.';
    let coverUrl = '';
    let firstChapterUrl: string | null = null;
    
    // --- READNOVELFULL, NOVELFULL.NET, NOVELFULL.COM, ALLNOVEL, NOVGO ---
    if (isReadNovelFull || isNovelFullNet || isNovelFullCom || isAllNovel || isNovgo) {
      const titleMatch = safeMatch(html, /<h3[^>]*class="title"[^>]*>([^<]+)<\/h3>/i) ||
                         safeMatch(html, /<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<div[^>]*class="book-title"[^>]*>([^<]+)<\/div>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      if (isReadNovelFull) {
        const authorMatch = safeMatch(html, /<span[^>]*itemprop="author"[^>]*>.*?<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i);
        if (authorMatch) author = decodeEntities(authorMatch);
      }
      
      if (isNovelFullNet || isNovelFullCom || isAllNovel || isNovgo) {
        const authorMatch = safeMatch(html, /<div[^>]*class="info"[^>]*>[\s\S]*?<h3>Author:<\/h3>\s*<a[^>]*>([^<]+)<\/a>/i);
        if (authorMatch) author = decodeEntities(authorMatch);
      }

      if (isReadNovelFull) {
        const descMatch = safeMatch(html, /<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      if (isNovelFullNet && !isNovelFullCom) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      if (isNovelFullCom) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) cleanedParagraphs.push(text.trim());
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      if (isAllNovel) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) cleanedParagraphs.push(text.trim());
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      if (isNovgo) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) cleanedParagraphs.push(text.trim());
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      const coverMatch = safeMatch(html, /<div[^>]*class="book"[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*>/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      const chapterMatch = safeMatch(html, /<(?:div|ul)[^>]*(?:id="(?:tab-chapters|list-chapter)"|class="list-chapter")[^>]*>.*?<li[^>]*>.*?<a[^>]*href="([^"]+)"/i);
      if (chapterMatch) {
        firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
      } else {
        const chapterLinkMatch = safeMatch(html, /<a[^>]*href="([^"]*chapter[-/]1[^"]*)"[^>]*>/i);
        if (chapterLinkMatch) firstChapterUrl = makeAbsoluteUrl(chapterLinkMatch, url);
      }
    }
    
    // --- FREEWEBNOVEL ---
    if (isFreeWebNovel) {
      console.log('[Scraper] FreeWebNovel detected');
      
      let baseNovelUrl = url.replace(/\/$/, '');
      if (baseNovelUrl.includes('/chapter-')) {
        baseNovelUrl = baseNovelUrl.split('/chapter-')[0];
      }
      firstChapterUrl = `${baseNovelUrl}/chapter-1`;
      console.log('[Scraper] Constructed first chapter URL:', firstChapterUrl);
      
      const titleMatch = safeMatch(html, /<h1[^>]*class="tit"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      const coverMatch = safeMatch(html, /<div[^>]*class="pic"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      const authorMatch = safeMatch(html, /<div[^>]*class="item"[^>]*>[\s\S]*?<div[^>]*class="right"[^>]*>[\s\S]*?<a[^>]*class="a1"[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      const innerMatch = safeMatch(html, /<div[^>]*class="inner"[^>]*>([\s\S]*?)<\/div>/i);
      if (innerMatch) {
        const paragraphs = innerMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).filter(t => t.length > 0).join('\n\n');
        }
      }
    }
    
    // --- LIGHTNOVELWORLD ---
    if (isLightNovelWorld) {
      console.log('[Scraper] LightNovelWorld detected');
      
      const titleMatch = safeMatch(html, /<h1[^>]*class="novel-title"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      const authorMatch = safeMatch(html, /<p[^>]*class="novel-author"[^>]*>[\s\S]*?<a[^>]*class="author-link"[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) {
        author = decodeEntities(authorMatch.trim());
      } else {
        const authorFallback = safeMatch(html, /<p[^>]*class="novel-author"[^>]*>([\s\S]*?)<\/p>/i);
        if (authorFallback) {
          author = decodeEntities(stripTags(authorFallback).replace(/^Author:\s*/i, '').trim());
        }
      }
      
      const coverMatch = safeMatch(html, /<img[^>]*class="novel-cover[^"]*"[^>]*src="([^"]+)"/i) ||
                         safeMatch(html, /<img[^>]*src="([^"]+)"[^>]*class="novel-cover[^"]*"/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      const summaryMatch = safeMatch(html, /<div[^>]*class="summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (summaryMatch) {
        const paragraphs = summaryMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).filter(t => t.length > 0).join('\n\n');
        }
      }
      
      const baseNovelUrl = url.replace(/\/$/, '');
      firstChapterUrl = `${baseNovelUrl}/chapter/1/`;
      console.log('[Scraper] Constructed first chapter URL:', firstChapterUrl);
    }

    // --- ROYALROAD ---
    if (isRoyalRoad) {
      console.log('[Scraper] RoyalRoad detected');
      
      const titleMatch = safeMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      const authorMatch = safeMatch(html, /<h4[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      const descMatch = safeMatch(html, /<div[^>]*class="description"[^>]*>([\s\S]*?)<\/div>/i);
      if (descMatch) {
        const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).filter(t => t.length > 0).join('\n\n');
        } else {
          synopsis = decodeEntities(stripTags(descMatch));
        }
      }
      
      const coverMatch = 
        safeMatch(html, /<div[^>]*class="[^"]*cover-art-container[^"]*"[^>]*>[\s\S]*?<img[^>]*class="[^"]*thumbnail[^"]*"[^>]*src="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<img[^>]*class="[^"]*thumbnail[^"]*"[^>]*src="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<img[^>]*data-type="cover"[^>]*src="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<figure[^>]*class="[^"]*cover-art[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<img[^>]*class="[^"]*cover[^"]*"[^>]*src="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i) ||
        safeMatch(html, /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"[^>]*>/i);
      
      if (coverMatch) {
        coverUrl = makeAbsoluteUrl(coverMatch, url);
        console.log('[Scraper] RoyalRoad cover found:', coverUrl);
      } else {
        console.log('[Scraper] RoyalRoad cover not found');
      }
      
      const chapterListMatch = safeMatch(html, /<table[^>]*class="chapters"[^>]*>([\s\S]*?)<\/table>/i) ||
                               safeMatch(html, /<div[^>]*class="chapter-list"[^>]*>([\s\S]*?)<\/div>/i) ||
                               safeMatch(html, /<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      
      if (chapterListMatch) {
        const firstChapterMatch = safeMatch(chapterListMatch, /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i) ||
                                  safeMatch(chapterListMatch, /<a[^>]*href="([^"]*\/chapters[^"]*)"[^>]*>/i);
        if (firstChapterMatch) {
          firstChapterUrl = makeAbsoluteUrl(firstChapterMatch, url);
          console.log('[Scraper] Found first chapter from chapter list:', firstChapterUrl);
        }
      }
      
      if (!firstChapterUrl) {
        const baseNovelUrl = url.replace(/\/$/, '');
        if (url.includes('/fiction/')) {
          const fictionIdMatch = url.match(/\/fiction\/(\d+)/i);
          if (fictionIdMatch) {
            firstChapterUrl = `${baseNovelUrl}/chapters/1`;
            console.log('[Scraper] Constructed first chapter URL with fiction ID:', firstChapterUrl);
          }
        }
        if (!firstChapterUrl) {
          firstChapterUrl = `${baseNovelUrl}/chapter/1/`;
          console.log('[Scraper] Constructed first chapter URL (fallback):', firstChapterUrl);
        }
      }
    }

    // --- WUXIAWORLD.SITE ---
    if (isWuxiaworld) {
      console.log('[Scraper] Wuxiaworld.site detected');
      
      const titleMatch = safeMatch(html, /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i);
      if (titleMatch) title = decodeEntities(stripTags(titleMatch));
      
      const authorMatch = safeMatch(html, /<div[^>]*class="author-content"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      let descMatch = safeMatch(html, /<div[^>]*class="description-summary"[^>]*>([\s\S]*?)<\/div>/i);
      if (!descMatch) {
        descMatch = safeMatch(html, /<div[^>]*class="summary_content show-more[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      }
      if (!descMatch) {
        descMatch = safeMatch(html, /<div[^>]*class="[^"]*summary_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      }
      
      if (descMatch) {
        let summaryHtml = descMatch;

        // The "You're Reading "Title" on WuxiaWorld.Site" boilerplate is
        // wrapped in <b><em>...</em></b> (or <em><b>...</b></em>) right at the
        // start of the summary, immediately followed by a <br/> and then the
        // real synopsis — all inside one single <p>. Strip that wrapped block
        // directly out of the HTML here, before any text conversion, so we
        // don't have to guess at it from plain text afterward.
        summaryHtml = summaryHtml.replace(/<b>\s*<em>[\s\S]*?<\/em>\s*<\/b>/gi, '');
        summaryHtml = summaryHtml.replace(/<em>\s*<b>[\s\S]*?<\/b>\s*<\/em>/gi, '');

        const paragraphs = summaryHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              // WuxiaWorld puts a <br> between nearly every sentence, not just
              // between real paragraphs — converting every single <br> to a
              // newline turns the synopsis into one sentence per line, which
              // breaks truncation/preview in the app. Only treat a genuine
              // double break (<br><br>, with optional whitespace between) as
              // a real paragraph break; collapse single breaks into a space
              // so the text flows normally.
              text = text.replace(/(?:<br\s*\/?>\s*){2,}/gi, '\n\n');
              text = text.replace(/<br\s*\/?>/gi, ' ');
              text = decodeEntities(text);
              text = stripTags(text);
              return text
                .split('\n\n')
                .map(para => para.replace(/\s+/g, ' ').trim())
                .filter(para => para.length > 0)
                .join('\n\n');
            })
            .filter(t => t.length > 0);
          let fullText = cleanedParagraphs.join('\n\n');
          synopsis = cleanSynopsis(fullText);
          console.log('[Scraper] Wuxiaworld extracted synopsis with', cleanedParagraphs.length, 'paragraphs');
        } else {
          let fallbackText = summaryHtml.replace(/<br\s*\/?>/gi, ' ');
          fallbackText = decodeEntities(stripTags(fallbackText));
          fallbackText = fallbackText.replace(/\s+/g, ' ').trim();
          synopsis = cleanSynopsis(fallbackText);
        }
      }
      
      const coverMatch = safeMatch(html, /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*data-src="([^"]+)"/i) ||
                         safeMatch(html, /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      const mangaIdMatch = safeMatch(html, /var\s+manga\s*=\s*\{[^}]*"manga_id"\s*:\s*"(\d+)"/i) ||
                           safeMatch(html, /"manga_id"\s*:\s*"(\d+)"/i);
      if (mangaIdMatch) {
        try {
          console.log('[Scraper] Wuxiaworld: Found manga_id', mangaIdMatch, ', fetching chapters via AJAX...');
          const ajaxUrl = 'https://wuxiaworld.site/wp-admin/admin-ajax.php';
          const formData = new URLSearchParams();
          formData.append('action', 'manga_get_chapters');
          formData.append('manga_id', mangaIdMatch);
          
          const ajaxResponse = await httpClient.post(ajaxUrl, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          
          const chapterHtml = ajaxResponse.data;
          console.log('[Scraper] Wuxiaworld AJAX response received, length:', chapterHtml.length);
          
          const chapterMatch = safeMatch(chapterHtml, /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i);
          if (chapterMatch) {
            firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
            console.log('[Scraper] Extracted first chapter from AJAX:', firstChapterUrl);
          }
        } catch (ajaxError: any) {
          console.warn('[Scraper] Wuxiaworld AJAX fetch failed:', ajaxError.message);
          const baseNovelUrl = url.replace(/\/$/, '');
          firstChapterUrl = `${baseNovelUrl}/chapter-1/`;
          console.log('[Scraper] Using constructed first chapter URL:', firstChapterUrl);
        }
      }
    }

    // --- ASIANOVEL.NET ---
    if (isAsianovel) {
      console.log('[Scraper] Asianovel.net detected');
      
      const titleMatch = safeMatch(html, /<h1[^>]*class="[^"]*story__identity-title[^"]*"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) title = decodeEntities(titleMatch.trim());
      
      const authorMetaMatch = safeMatch(html, /<div[^>]*class="[^"]*story__identity-meta[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      asianovelDebug.push(`author: story__identity-meta div found: ${!!authorMetaMatch}`);
      if (authorMetaMatch) {
        asianovelDebug.push(`author: meta div raw content: ${authorMetaMatch.slice(0, 200)}`);
        // Prefer an <a href="/author/...">Name</a> link (most reliable — doesn't
        // depend on the anchor's class attribute, which can vary/be blank).
        let authorAnchorMatch = authorMetaMatch.match(/<a[^>]*\bhref="[^"]*\/author\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        // Fall back to any <a> with an "author" class if no /author/ href is found.
        if (!authorAnchorMatch) {
          authorAnchorMatch = authorMetaMatch.match(/<a[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        }
        // Last resort: any <a> at all inside the meta block.
        if (!authorAnchorMatch) {
          authorAnchorMatch = authorMetaMatch.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
        }
        asianovelDebug.push(`author: anchor matched: ${!!authorAnchorMatch}`);
        if (authorAnchorMatch) {
          asianovelDebug.push(`author: raw captured group: ${JSON.stringify(authorAnchorMatch[1])}`);
          const cleanedAuthor = decodeEntities(stripTags(authorAnchorMatch[1])).replace(/\s+/g, ' ').trim();
          asianovelDebug.push(`author: cleaned result: ${JSON.stringify(cleanedAuthor)}`);
          if (cleanedAuthor) author = cleanedAuthor;
        }
      }
      
      const thumbFigureMatch = safeMatch(html, /<figure[^>]*class="[^"]*story__thumbnail[^"]*"[^>]*>([\s\S]*?)<\/figure>/i);
      if (thumbFigureMatch) {
        let rawCover: string | undefined;

        // Prefer the <a href="..."> wrapping the thumbnail — it points directly
        // to the full-size image file (e.g. .../uploads/2025/06/xxxxx_300_420.jpg)
        const anchorTagMatch = thumbFigureMatch.match(/<a\b[^>]*>/i);
        if (anchorTagMatch) {
          const hrefMatch = anchorTagMatch[0].match(/\bhref="([^"]+)"/i);
          if (hrefMatch && /\.(jpe?g|png|webp)(\?.*)?$/i.test(hrefMatch[1])) {
            rawCover = hrefMatch[1];
          }
        }

        // Fall back to the <img> tag's src/data-src if no valid anchor href found
        if (!rawCover) {
          const imgTagMatch = thumbFigureMatch.match(/<img\b[^>]*>/i);
          if (imgTagMatch) {
            const imgTag = imgTagMatch[0];
            const srcMatch = imgTag.match(/\bsrc="([^"]+)"/i);
            const dataSrcMatch = imgTag.match(/\bdata-src="([^"]+)"/i);
            rawCover = (srcMatch && srcMatch[1]) || (dataSrcMatch && dataSrcMatch[1]);
          }
        }

        if (rawCover) coverUrl = makeAbsoluteUrl(rawCover, url);
      }
      
      const descMatch = safeMatch(html, /<section[^>]*class="[^"]*story__summary[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
      if (descMatch) {
        const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0)
            // Drop the "Related Stories:" / "No related posts." boilerplate
            // widget that sometimes sits inside the same summary section.
            .filter(t => !/^related\s+(stories|posts|series)\s*:?\s*$/i.test(t))
            .filter(t => !/^no\s+related\s+(posts|stories)\.?\s*$/i.test(t));
          synopsis = cleanedParagraphs.join('\n\n');
        } else {
          synopsis = decodeEntities(stripTags(descMatch));
        }

        // Safety net: the paragraph-level filter above only catches the case
        // where "Related Stories:" / "No related posts." are their own,
        // isolated <p> tags. Some pages mix it into the tail end of the last
        // real paragraph instead (e.g. joined with a <br> rather than a
        // separate <p>), which the filter above would miss entirely. Since
        // this widget always appears at the very END of the summary and
        // never partway through real synopsis prose, it's safe to just
        // truncate everything from that marker onward, wherever it appears.
        synopsis = synopsis
          .replace(/related\s+(stories|posts|series)\s*:[\s\S]*$/i, '')
          .trim();
      }
      
      const asianovelChapterLinkRegex = /<a\b[^>]*>/gi;
      let chapterLinkTagMatch: RegExpExecArray | null;
      while ((chapterLinkTagMatch = asianovelChapterLinkRegex.exec(html)) !== null) {
        const tag = chapterLinkTagMatch[0];
        if (!/class="[^"]*chapter-group__list-item-link[^"]*"/i.test(tag)) continue;
        const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
        if (hrefMatch && hrefMatch[1]) {
          firstChapterUrl = makeAbsoluteUrl(hrefMatch[1], url);
          console.log('[Scraper] Asianovel first chapter URL (chapter-group__list-item-link):', firstChapterUrl);
        }
        break;
      }
      
      if (!firstChapterUrl) {
        const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        if (jsonLdBlocks) {
          for (const block of jsonLdBlocks) {
            const inner = safeMatch(block, /<script[^>]*>([\s\S]*?)<\/script>/i);
            if (!inner) continue;
            try {
              const data = JSON.parse(inner);
              const graph = Array.isArray(data) ? data : (data['@graph'] || [data]);
              for (const node of graph) {
                if (node && node['@type'] === 'ItemList' && node['name'] === 'Chapters') {
                  const items = node.itemListElement || [];
                  if (items.length > 0 && items[0].url) {
                    firstChapterUrl = makeAbsoluteUrl(items[0].url, url);
                    console.log('[Scraper] Asianovel first chapter URL (JSON-LD fallback):', firstChapterUrl);
                  }
                }
              }
            } catch {
              // skip
            }
            if (firstChapterUrl) break;
          }
        }
      }
      
      if (!firstChapterUrl) {
        // Asianovel chapter URLs use opaque numeric IDs (e.g. /chapter/58421/),
        // NOT a "chapter-1", "chapter-2"... slug — so we can't guess the URL
        // from a pattern like other sites. Instead, pull the real chapter list
        // out of the DOM and take its first entry (already sorted so index 0 = ch. 1).
        const chapterEntries = extractAsianovelChapterLinks(html, url);
        if (chapterEntries.length > 0) {
          firstChapterUrl = chapterEntries[0].url;
          console.log('[Scraper] Asianovel first chapter URL (chapter list DOM):', firstChapterUrl);
        } else {
          console.log('[Scraper] Asianovel: could not determine first chapter URL');
        }
      }
    }
    
    console.log('[Scraper] Found first chapter:', firstChapterUrl);
    console.log('[Scraper] Found cover URL:', coverUrl);
    
    return {
      title: decodeEntities(title),
      author: decodeEntities(author),
      synopsis: decodeEntities(synopsis),
      coverUrl,
      firstChapterUrl,
      debugInfo: isAsianovel ? asianovelDebug : undefined
    };
  } catch (error: any) {
    console.error('[Scraper] Error:', error.message);
    throw new Error(`Failed to fetch novel: ${error.message}`);
  }
};

// Helper: extract every chapter <a href> from the <ol class="chapter-group__list">
// blocks on an Asianovel (Fictioneer) novel page, in true reading order.
//
// IMPORTANT: Asianovel chapter/story URLs use opaque numeric post IDs
// (e.g. https://www.asianovel.net/story/3377/, /chapter/58421/) — NOT a
// sequential "chapter-1", "chapter-2"... slug like other sites. So chapter
// number/order can NEVER be derived from the URL itself. Instead:
//   1. Items are read straight out of the DOM in the order they appear.
//   2. The <section ... data-order="asc"|"desc" ...> wrapper attribute tells us
//      whether that DOM order is oldest-first (asc) or newest-first (desc);
//      we reverse the array when needed so index 0 is always chapter 1.
//   3. Numbering itself is done later from the chapter's own link text
//      (title), only falling back to position if no number is present there.
const extractAsianovelChapterLinks = (html: string, baseUrl: string): { url: string; title: string }[] => {
  const entries: { url: string; title: string }[] = [];
  const seenUrls = new Set<string>();

  const listBlockRegex = /<ol[^>]*class="[^"]*chapter-group__list[^"]*"[^>]*>([\s\S]*?)<\/ol>/gi;
  let listBlockMatch: RegExpExecArray | null;

  while ((listBlockMatch = listBlockRegex.exec(html)) !== null) {
    const listHtml = listBlockMatch[1];

    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;

    while ((liMatch = liRegex.exec(listHtml)) !== null) {
      const liInner = liMatch[1];

      // Items like the "_folding-toggle" expand/collapse control have no
      // chapter <a href> and are skipped naturally here.
      const anchorMatch = liInner.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchorMatch) continue;

      const chapterUrl = makeAbsoluteUrl(anchorMatch[1], baseUrl);
      if (seenUrls.has(chapterUrl)) continue;
      seenUrls.add(chapterUrl);

      const title = decodeEntities(stripTags(anchorMatch[2])).replace(/\s+/g, ' ').trim();
      entries.push({ url: chapterUrl, title });
    }
  }

  // Determine whether the DOM order above is oldest-first or newest-first
  const orderAttrMatch = html.match(/data-order="(asc|desc)"/i);
  const domOrder = orderAttrMatch ? orderAttrMatch[1].toLowerCase() : 'asc';
  if (domOrder === 'desc') entries.reverse();

  return entries;
};

// --- ASIANOVEL.NET (Fictioneer WordPress) — full chapter list ---
// Extracts every chapter from the <ol class="chapter-group__list"> blocks on the
// novel page, in proper reading order (see extractAsianovelChapterLinks above
// for why we can't use the URL to figure out chapter numbers on this site).
// Chapter number is taken from the link's own title text when present
// (e.g. "Chapter 12", "12: Title"); otherwise it falls back to the chapter's
// position in the corrected reading-order list (index + 1).
export const directFetchAsianovelChapterList = async (url: string): Promise<ChapterListItem[]> => {
  try {
    const html = await fetchAsianovel(url);
    const entries = extractAsianovelChapterLinks(html, url);

    const chapters: ChapterListItem[] = entries.map((entry, index) => {
      let chapterNumber: number | null = null;
      const textNumMatch = entry.title.match(/(?:chapter\s*)?(\d+)/i);
      if (textNumMatch) chapterNumber = parseInt(textNumMatch[1], 10);

      if (chapterNumber === null || Number.isNaN(chapterNumber)) {
        chapterNumber = index + 1; // fall back to reading-order position
      }

      return {
        number: chapterNumber,
        title: entry.title || `Chapter ${chapterNumber}`,
        url: entry.url,
      };
    });

    console.log(`[Scraper] Asianovel chapter list: found ${chapters.length} chapters`);
    return chapters;
  } catch (error: any) {
    console.error('[Scraper] Error fetching Asianovel chapter list:', error.message);
    throw new Error(`Failed to fetch chapter list: ${error.message}`);
  }
};

// The CHAPTER page (not the story page) has its own chapter index, embedded
// in a hidden dialog: <ul id="chapter-index-list" class="chapter-index__list">
// with <li data-position="N" data-id="POST_ID"><a href="...">...</a></li>.
// This is even more reliable than the story page's list — data-position is
// an explicit, authoritative sequence number with no data-order guessing
// needed. Used to find the true "next chapter" URL instead of scanning for
// any <a> that happens to contain the word "next" (too fragile — matches
// unrelated recommendation/suggestion links elsewhere on the page).
const extractAsianovelChapterIndexList = (
  html: string,
  baseUrl: string
): { position: number; url: string; title: string }[] => {
  const listMatch = html.match(/<ul[^>]*id="chapter-index-list"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!listMatch) return [];

  const listHtml = listMatch[1];
  const entries: { position: number; url: string; title: string }[] = [];

  const liRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(listHtml)) !== null) {
    const liAttrs = liMatch[1];
    const liInner = liMatch[2];

    const positionMatch = liAttrs.match(/data-position="(\d+)"/i);
    if (!positionMatch) continue;
    const position = parseInt(positionMatch[1], 10);

    const anchorMatch = liInner.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;

    const url = makeAbsoluteUrl(anchorMatch[1], baseUrl);
    const title = decodeEntities(stripTags(anchorMatch[2])).replace(/\s+/g, ' ').trim();

    entries.push({ position, url, title });
  }

  entries.sort((a, b) => a.position - b.position);
  return entries;
};

export const directFetchChapter = async (url: string, chapterNum: number): Promise<ChapterData> => {
  console.log('[Scraper] Fetching chapter:', url);
  
  try {
    const domainLower = url.toLowerCase();
    const isReadNovelFull = domainLower.includes('readnovelfull');
    const isNovelFullNet = domainLower.includes('novelfull.net') && !isReadNovelFull;
    const isNovelFullCom = domainLower.includes('novelfull.com');
    const isAllNovel = domainLower.includes('allnovel.org');
    const isNovgo = domainLower.includes('novgo.net');
    const isFreeWebNovel = domainLower.includes('freewebnovel');
    const isLightNovelWorld = domainLower.includes('lightnovelworld');
    const isRoyalRoad = domainLower.includes('royalroad');
    const isWuxiaworld = domainLower.includes('wuxiaworld.site');
    const isAsianovel = domainLower.includes('asianovel.net');
    
    let html: string;
    let fetchMethod: 'fetch' | 'fetch-proxy' = 'fetch';
    let httpStatus = 200;
    let contentType = 'text/html';

    if (isLightNovelWorld) {
      const result = await fetchLightNovelWorld(url);
      html = result.html;
      fetchMethod = result.fetchMethod;
      httpStatus = result.httpStatus;
      contentType = result.contentType;
    } else {
      html = await fetchWithFallback(url, isFreeWebNovel, isAsianovel);
    }
    
    let title = `Chapter ${chapterNum}`;
    let skipCleanup = false;
    
    if (isReadNovelFull || isNovelFullNet || isNovelFullCom || isAllNovel || isNovgo) {
      const titleMatch = safeMatch(html, /<span[^>]*class="(?:chr-text|chapter-text)"[^>]*>([^<]+)<\/span>/i) ||
                         safeMatch(html, /<a[^>]*class="(?:chr-title|chapter-title)"[^>]*title="([^"]+)"/i) ||
                         safeMatch(html, /<(?:h2|h3)[^>]*class="(?:chapter-title|title|chapter)"[^>]*>([^<]+)<\/(?:h2|h3)>/i) ||
                         safeMatch(html, /<(?:h2|h3)[^>]*>([^<]*Chapter[^<]*)<\/(?:h2|h3)>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/^.*Chapter\s+\d+(\s+\d+)?\s*[:.\-–—]?\s*/i, '').trim();
        rawTitle = rawTitle.replace(/^[\s,]+/, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }
        
    if (isFreeWebNovel) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="tit"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h4[^>]*>([^<]*Chapter[^<]*)<\/h4>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]\s*/gi, '').trim();
        rawTitle = rawTitle.replace(new RegExp(`^\\s*${chapterNum}\\s*[:.\\-–—]?\\s*`, 'i'), '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }
    
    if (isLightNovelWorld) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }

    if (isRoyalRoad) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h1[^>]*itemprop="headline"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i) ||
                         safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }

    if (isWuxiaworld) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="post-title"[^>]*>([\s\S]*?)<\/h1>/i) ||
                         safeMatch(html, /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i) ||
                         safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(stripTags(titleMatch)).trim().replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
      
      let contentHtml = null;
      const contentMatch1 = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch2 = safeMatch(html, /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch3 = safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch4 = safeMatch(html, /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch5 = safeMatch(html, /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch6 = safeMatch(html, /<article[^>]*class="chapter"[^>]*>([\s\S]*?)<\/article>/i);
      
      contentHtml = contentMatch1 || contentMatch2 || contentMatch3 || contentMatch4 || contentMatch5 || contentMatch6;
      
      if (contentHtml) {
        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              text = text.replace(/<br\s*\/?>/gi, '\n\n');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          const extractedContent = cleanedParagraphs.join('\n\n');
          if (extractedContent.length > 0) {
            // store later
          }
        } else {
          let text = decodeEntities(stripTags(contentHtml));
          text = text.replace(/<br\s*\/?>/gi, '\n\n');
        }
      }
    }

    if (isAsianovel) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="[^"]*chapter__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
                         safeMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(stripTags(titleMatch)).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/^Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        if (rawTitle) {
          title = `Chapter ${chapterNum}: ${rawTitle}`;
          skipCleanup = true;
        }
      }
    }
    
    let paragraphMatches = null;
    
    if (isLightNovelWorld) {
      const { paragraphs, selector } = lnwExtractParagraphs(html);
      const filtered = lnwFilterParagraphs(paragraphs);
      console.log(`[LNW] Extracted ${paragraphs.length}, kept ${filtered.length} after filtering`);
      
      return {
        url,
        title: decodeEntities(title),
        content: filtered.join('\n\n') || 'No content available.',
        nextUrl: (() => {
          const linkRegex2 = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
          let lm2: RegExpExecArray | null;
          while ((lm2 = linkRegex2.exec(html)) !== null) {
            const hrefM = lm2[1].match(/href=["']([^"']+)["']/i);
            const href2 = hrefM ? hrefM[1] : null;
            const txt2  = stripTags(lm2[2]).toLowerCase();
            const cls2  = (lm2[1].match(/class=["']([^"']*)["']/i) || [])[1]?.toLowerCase() ?? '';
            const id2   = (lm2[1].match(/id=["']([^"']*)["']/i)    || [])[1]?.toLowerCase() ?? '';
            const attrs2 = cls2 + ' ' + id2;
            if ((txt2.includes('next') || attrs2.includes('next') || attrs2.includes('next_chapter')) && href2) {
              const next = makeAbsoluteUrl(href2, url);
              console.log('[Scraper] Found next chapter:', next);
              return next;
            }
          }
          console.log('[Scraper] No next chapter found.');
          return null;
        })(),
        scraperInfo: {
          selector: selector,
          rawCount: paragraphs.length,
          filteredCount: filtered.length,
          htmlLength: html.length,
          pTagCount: (html.match(/<p[\s>]/gi) || []).length,
          fetchMethod: fetchMethod,
          httpStatus: httpStatus,
          jsInjected: false,
          chapterTextCount: (html.match(/id="chapterText"/g) || []).length,
          contentType: contentType,
        }
      };
    }
    
    if (!paragraphMatches) {
      paragraphMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gis);
    }
    
    const validParagraphs: string[] = [];
    
    if (paragraphMatches) {
      for (const p of paragraphMatches) {
        let text = stripTags(p);
        text = decodeEntities(text);
        if (text.length > 5 && 
            !text.toLowerCase().includes('next chapter') &&
            !text.toLowerCase().includes('previous chapter') &&
            !text.toLowerCase().includes('back to') &&
            !text.toLowerCase().includes('table of contents')) {
          validParagraphs.push(text);
        }
      }
    }
    
    let content = '';
    
    if (isAsianovel) {
      // Primary method: depth-counting extraction anchored on the outer
      // <section id="chapter-content">...</section> wrapper. This correctly
      // captures the FULL content even though it contains nested ad <div>s
      // (top and bottom) that would trip up a naive non-greedy </div> or
      // </section> match. See extractAsianovelChapterContentHtml for details.
      let contentHtml: string | null = extractAsianovelChapterContentHtml(html);

      // Fallback: quote-aware regex selectors, only used if the primary
      // depth-counting method didn't find anything (e.g. markup changed).
      if (!contentHtml) {
        const ATTR = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
        const ASIANOVEL_CONTENT_SELECTORS: RegExp[] = [
          new RegExp(`<section${ATTR}class="[^"]*chapter-formatting[^"]*"${ATTR}>([\\s\\S]*?)<\\/section>`, 'i'),
          new RegExp(`<div${ATTR}class="[^"]*chapter-formatting[^"]*"${ATTR}>([\\s\\S]*?)<\\/div>`, 'i'),
          new RegExp(`<[a-z]+${ATTR}\\bid="chapter-content"${ATTR}>([\\s\\S]*?)<\\/(?:div|section|article)>`, 'i'),
          new RegExp(`<div${ATTR}class="[^"]*chapter__content[^"]*"${ATTR}>([\\s\\S]*?)<\\/div>`, 'i'),
          new RegExp(`<[a-z]+${ATTR}class="[^"]*content-section[^"]*"${ATTR}>([\\s\\S]*?)<\\/(?:div|section)>`, 'i'),
        ];

        for (const selector of ASIANOVEL_CONTENT_SELECTORS) {
          const match = safeMatch(html, selector);
          if (match) {
            contentHtml = match;
            break;
          }
        }
      }
      
      if (contentHtml) {
        contentHtml = contentHtml
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '');
        
        // No need to specifically strip ad <div> wrappers here — they contain
        // no <p> tags (just <script>/<ins>), so the <p>-only extraction below
        // naturally skips over them.
        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              text = text.replace(/<br\s*\/?>/gi, '\n');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          content = cleanedParagraphs.join('\n\n');
        }
        if (!content) {
          let text = decodeEntities(stripTags(contentHtml));
          text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
          if (text) content = text;
        }
      }
    }
    
    if (isWuxiaworld && !content) {
      const contentMatch1 = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch2 = safeMatch(html, /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch3 = safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch4 = safeMatch(html, /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch5 = safeMatch(html, /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      
      const contentHtml = contentMatch1 || contentMatch2 || contentMatch3 || contentMatch4 || contentMatch5;
      
      if (contentHtml) {
        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              text = text.replace(/<br\s*\/?>/gi, '\n\n');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          content = cleanedParagraphs.join('\n\n');
        } else {
          let text = decodeEntities(stripTags(contentHtml));
          text = text.replace(/<br\s*\/?>/gi, '\n\n');
          content = text;
        }
      }
    }
    
    if (!content) {
      if (isFreeWebNovel && validParagraphs.length > 0) {
        const junkPhrases = [
          'panda',
          'novɐ1',
          'com',
          'freewebnovel.com',
          'freewebnovel',
          '𝕗𝚛𝚎𝚎𝐰𝗲𝗯𝗻𝚘𝚟𝚎𝗹.𝕔𝐨𝕞',
          'please visit',
          'for a better experience',
          'click here',
          'download the app',
          'read latest chapters',
          'follow on',
          'facebook',
          'twitter',
          'instagram',
          'discord',
          'support the author',
          'donate',
          'patreon',
        ];
        const filtered = validParagraphs.filter(text => {
          const lower = text.toLowerCase();
          return !junkPhrases.some(phrase => lower.includes(phrase));
        });
        content = filtered.join('\n\n') || validParagraphs.join('\n\n');
      } else if ((isNovelFullNet || isReadNovelFull || isNovelFullCom || isAllNovel || isNovgo) && validParagraphs.length > 0) {
        const junkPhrases = [
          'we are offering free books',
          'read novel updated daily',
          'light novel translations',
          'web novel, chinese novel',
          'japanese novel, korean novel',
          'other novel online',
          'novelfull.com',
          'readnovelfull.com',
          'allnovel.org',
          'novgo.net',
        ];
        const filtered = validParagraphs.filter(text => {
          const lower = text.toLowerCase();
          return !junkPhrases.some(phrase => lower.includes(phrase));
        });
        content = filtered.join('\n\n') || validParagraphs.join('\n\n');
      } else if (validParagraphs.length > 0) {
        content = validParagraphs.join('\n\n');
      }
    }
    
    if (!content) {
      const contentMatch = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
                           safeMatch(html, /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i);
      if (contentMatch) {
        const innerParagraphs = contentMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
        if (innerParagraphs) {
          const texts: string[] = [];
          for (const p of innerParagraphs) {
            let text = stripTags(p);
            text = decodeEntities(text);
            if (text.length > 5) texts.push(text);
          }
          content = texts.join('\n\n');
        } else {
          content = decodeEntities(stripTags(contentMatch));
        }
      }
    }
    
    let nextUrl: string | null = null;
    
    // --- ASIANOVEL.NET: reliable next-chapter lookup ---
    // The generic "any <a> containing the word 'next'" scan below is too
    // fragile on Fictioneer pages — there are unrelated links (recommended
    // chapters, "keep reading" widgets, etc.) that also match "next" in
    // their text/class/id, and the FIRST one found on the page wins, which
    // can jump to a completely unrelated chapter. Instead, this exact page
    // embeds its own chapter index (in a hidden dialog) with explicit
    // data-position numbers — <li data-position="N" data-id="POST_ID"> — so
    // we can find the current chapter's real position and take the next
    // entry's real URL directly. No guessing based on link text, and no
    // assuming chapter IDs in the URL are sequential (they sometimes skip).
    if (isAsianovel) {
      const indexEntries = extractAsianovelChapterIndexList(html, url);
      if (indexEntries.length > 0) {
        const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
        const currentIndex = indexEntries.findIndex(e => normalize(e.url) === normalize(url));
        if (currentIndex !== -1 && currentIndex + 1 < indexEntries.length) {
          nextUrl = indexEntries[currentIndex + 1].url;
          console.log('[Scraper] Asianovel next chapter (data-position index):', nextUrl);
        } else if (currentIndex === -1) {
          console.log('[Scraper] Asianovel: current chapter not found in index list, trying story-page chapter list');
        } else {
          console.log('[Scraper] Asianovel: this is the last chapter in the list');
        }
      }
      // Fall back to the story-page-style chapter-group__list, in case this
      // particular page didn't embed the chapter-index-list dialog.
      if (!nextUrl) {
        const chapterEntries = extractAsianovelChapterLinks(html, url);
        if (chapterEntries.length > 0) {
          const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
          const currentIndex = chapterEntries.findIndex(e => normalize(e.url) === normalize(url));
          if (currentIndex !== -1 && currentIndex + 1 < chapterEntries.length) {
            nextUrl = chapterEntries[currentIndex + 1].url;
            console.log('[Scraper] Asianovel next chapter (chapter-group__list fallback):', nextUrl);
          }
        }
      }
    }
    
    const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    
    while (!nextUrl && (linkMatch = linkRegex.exec(html)) !== null) {
      const attrsStr = linkMatch[1];
      const innerHtml = linkMatch[2];
      
      const hrefMatch = attrsStr.match(/href=["']([^"']+)["']/i);
      const href = hrefMatch ? hrefMatch[1] : null;
      
      const txt = stripTags(innerHtml).toLowerCase();
      
      const classMatch = attrsStr.match(/class=["']([^"']*)["']/i);
      const classAttr = classMatch ? classMatch[1].toLowerCase() : '';
      
      const idMatch = attrsStr.match(/id=["']([^"']*)["']/i);
      const idAttr = idMatch ? idMatch[1].toLowerCase() : '';
      
      const attrs = classAttr + ' ' + idAttr;
      
      if ((txt.includes('next') || txt.includes('next chapter') || 
           attrs.includes('next') || attrs.includes('next_chapter')) && href) {
        nextUrl = makeAbsoluteUrl(href, url);
        console.log('[Scraper] Found next chapter:', nextUrl);
        break;
      }
    }
    
    if (!nextUrl) {
      console.log('[Scraper] No next chapter found.');
    }
    
    return {
      url,
      title: decodeEntities(title),
      content: content || 'No content available.',
      nextUrl
    };
  } catch (error: any) {
    console.error('[Scraper] Error:', error.message);
    throw new Error(`Failed to fetch chapter: ${error.message}`);
  }
};

export async function downloadNovelByCrawling(
  startUrl: string,
  novelId: string,
  saveChapter: (novelId: string, chapterIndex: number, title: string, content: string) => Promise<void>,
  onProgress?: (chapterNumber: number, title: string) => void,
  delayMs: number = 500
): Promise<void> {
  let currentUrl: string | null = startUrl;
  let chapterNumber = 1;
  
  while (currentUrl) {
    console.log(`[Downloader] Fetching chapter ${chapterNumber} from ${currentUrl}`);
    
    try {
      const chapter = await directFetchChapter(currentUrl, chapterNumber);
      await saveChapter(novelId, chapterNumber, chapter.title, chapter.content);
      
      if (onProgress) {
        onProgress(chapterNumber, chapter.title);
      }
      
      currentUrl = chapter.nextUrl;
      chapterNumber++;
      
      if (delayMs > 0 && currentUrl) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error: any) {
      console.error(`[Downloader] Failed at chapter ${chapterNumber}:`, error.message);
      throw new Error(`Download failed at chapter ${chapterNumber}: ${error.message}`);
    }
  }
  
  console.log(`[Downloader] Completed. Total chapters: ${chapterNumber - 1}`);
}
