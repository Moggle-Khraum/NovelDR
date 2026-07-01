import axios from 'axios';
import { decodeHTML } from 'entities';

export interface NovelMeta {
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string;
  firstChapterUrl: string | null;
}

export interface ChapterData {
  url: string;
  title: string;
  content: string;
  nextUrl: string | null;
  /** Populated only for LNW — shows which selector path was used, paragraph counts, and connection diagnostics */
  scraperInfo?: {
    selector: 'chapterText' | 'chapter-text' | 'generic-fallback';
    rawCount: number;
    filteredCount: number;
    htmlLength: number;
    pTagCount: number;
    // Connection diagnostics
    fetchMethod: 'fetch' | 'fetch-proxy';
    httpStatus: number;
    jsInjected: boolean;        // true if LNW TTS duplicate pattern detected in raw HTML
    chapterTextCount: number;   // how many times #chapterText appears (should be 1)
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

// Extract title from URL (same as Python)
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
  } catch (error) {
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

// Create axios instance with HTTP/1.1 preference via headers - IMPROVED for Asianovel
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

// LNW-specific fetch — uses native fetch with minimal headers matching the
// Python requests library. Sending full browser Sec-Fetch-* / Sec-Ch-Ua headers
// causes LNW to inject duplicate TTS paragraph content server-side.
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

// Special fetch function for Asianovel with better headers
const fetchAsianovel = async (url: string): Promise<string> => {
  console.log('[Scraper] Fetching Asianovel with special headers...');
  
  // Try with a more browser-like User-Agent and additional headers
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  try {
    // First try with axios
    const response = await axios.get(url, {
      headers: headers,
      timeout: 15000,
      maxRedirects: 5,
    });
    return response.data;
  } catch (error: any) {
    console.warn('[Scraper] Asianovel direct fetch failed:', error.message);
    
    // Try with fetch API
    try {
      const response = await fetch(url, {
        headers: headers,
        redirect: 'follow',
      });
      const html = await response.text();
      return html;
    } catch (fetchError: any) {
      console.warn('[Scraper] Asianovel fetch API failed:', fetchError.message);
      
      // Final fallback: try with proxy
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const proxyResponse = await axios.get(proxyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });
      return proxyResponse.data;
    }
  }
};

// Fetch with fallback to proxy for FreeWebNovel
const fetchWithFallback = async (url: string, isFreeWebNovel: boolean, isAsianovel: boolean = false): Promise<string> => {
  // Special handling for Asianovel
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

// ─── LightNovelWorld: div-depth content extractor ────────────────────────────
// Mirrors the Python extract_inner_html() logic exactly.
// A simple regex stops at the FIRST nested </div> (e.g. an ad container),
// so we walk the string manually with a depth counter instead.
const lnwExtractInnerHtml = (html: string): string | null => {
  const primaryMarker = 'id="chapterText"';
  let start = html.indexOf(primaryMarker);
  let usedFallback = false;

  if (start === -1) {
    // Try class-based fallback selector
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

  // Strip ad containers, style, and script blocks entirely — same intent as
  // Python extract_inner_html(). Do not inject replacement <p> tags here; doing
  // so mutates paragraph boundaries and can create duplicate-looking fragments.
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

// ─── LightNovelWorld: paragraph extractor ────────────────────────────────────
// Mirrors Python extract_paragraphs() — isolates #chapterText with the depth
// counter, strips noise, then pulls <p> tags. Falls back to a full-page scan.
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

// ─── LightNovelWorld: junk filter ────────────────────────────────────────────
// Mirrors Python filter_paragraphs() + deduplicate().
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

  // Match Python deduplicate(): remove only consecutive identical paragraphs.
  // This preserves repeated prose that appears intentionally later in a chapter
  // while still cleaning accidental adjacent duplicates.
  const deduped: string[] = [];
  for (const p of results) {
    if (deduped.length === 0 || p !== deduped[deduped.length - 1]) {
      deduped.push(p);
    }
  }

  return deduped;
};

// ─── Synopsis cleaning ─────────────────────────────────────────────────────────
// Clean synopsis by removing boilerplate text and formatting paragraphs (especially for Wuxiaworld)
// ─── Synopsis cleaning ─────────────────────────────────────────────────────────
// Clean synopsis by removing boilerplate text and formatting paragraphs (especially for Wuxiaworld)
const cleanSynopsis = (text: string): string => {
  if (!text) return '';
  
  // List of boilerplate patterns to remove - more comprehensive
  // Single boilerplate pattern to remove - matches both with and without "on WuxiaWorld.Site"
  const boilerplatePattern = /You'?re\s+Reading\s+[“"](.+?)[”"]\s*(?:on\s+WuxiaWorld\.?Site)?/gi;
  
  let cleaned = text;
  
  // Remove each boilerplate pattern
  for (const pattern of boilerplatePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove any leading punctuation or spaces after cleaning
  cleaned = cleaned.replace(/^[,.:;!?\s]+/, '');
  
  // Fix paragraph formatting - split on common paragraph separators
  // First, replace multiple newlines with a single newline
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Split by periods followed by space and capital letter (sentence boundaries)
  // but keep the period
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 1) {
    // Group sentences into paragraphs (every 2-3 sentences)
    const paragraphs: string[] = [];
    let currentParagraph: string[] = [];
    let sentenceCount = 0;
    
    for (const sentence of sentences) {
      currentParagraph.push(sentence.trim());
      sentenceCount++;
      
      // Start a new paragraph after 2-3 sentences or if it's a short sentence
      if (sentenceCount >= 3 || sentence.length < 50) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
        sentenceCount = 0;
      }
    }
    
    // Add any remaining sentences
    if (currentParagraph.length > 0) {
      paragraphs.push(currentParagraph.join(' '));
    }
    
    cleaned = paragraphs.join('\n\n');
  } else {
    // If no sentence boundaries found, try splitting by common paragraph markers
    cleaned = cleaned.replace(/\.\s+(?=[A-Z])/g, '.\n\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  }
  
  // Clean up extra whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
  
  // Remove any remaining boilerplate
  for (const pattern of boilerplatePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  cleaned = cleaned.replace(/^[,.:;!?\s]+/, '').trim();
  
  return cleaned || text; // Return original if cleaning removed everything
};

// ─────────────────────────────────────────────────────────────────────────────

export const directFetchNovelMeta = async (url: string): Promise<NovelMeta> => {
  console.log('[Scraper] Fetching novel meta from:', url);
  
  try {
    const domainLower = url.toLowerCase();
    const isReadNovelFull = domainLower.includes('readnovelfull');
    const isNovelFullNet = domainLower.includes('novelfull.net') && !isReadNovelFull;
    const isNovelFullCom = domainLower.includes('novelfull.com');
    const isAllNovel = domainLower.includes('allnovel.org');
    const isNovgo = domainLower.includes('novgo.net');
    const isFreeWebNovel = domainLower.includes('freewebnovel') || domainLower.includes('bednovel');
    const isNovelBin = domainLower.includes('novelbin');
    const isLightNovelWorld = domainLower.includes('lightnovelworld');
    const isRoyalRoad = domainLower.includes('royalroad.com');
    const isWuxiaworld = domainLower.includes('wuxiaworld.site');
    const isAsianovel = domainLower.includes('asianovel.net');
    
    const html = await fetchWithFallback(url, isFreeWebNovel, isAsianovel);
    
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
    
    // --- NOVELBIN ---
    if (isNovelBin) {
      console.log('[Scraper] Novelbin detected');
      
      const titleMatch = safeMatch(html, /<h3[^>]*class="title"[^>]*itemprop="name"[^>]*>([^<]+)<\/h3>/i) ||
                         safeMatch(html, /<h3[^>]*itemprop="name"[^>]*class="title"[^>]*>([^<]+)<\/h3>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      const coverMatch = safeMatch(html, /<div[^>]*class="book"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      const authorMatch = safeMatch(html, /<span[^>]*itemprop="author"[^>]*>[\s\S]*?<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      const descDivMatch = html.match(/<div[^>]*id="novel-description-content"[^>]*>([\s\S]*?)<\/div>/i);
      if (descDivMatch) {
        const innerHtml = descDivMatch[1];
        const paragraphs = innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs && paragraphs.length > 0) {
          synopsis = paragraphs
            .map(p => decodeEntities(stripTags(p)))
            .filter(t => t.length > 20)
            .join('\n\n');
          console.log('[Scraper] Extracted synopsis with', paragraphs.length, 'paragraphs');
        } else {
          synopsis = decodeEntities(stripTags(innerHtml));
        }
      } else {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
          if (paragraphs) {
            synopsis = paragraphs.map(p => decodeEntities(stripTags(p))).filter(t => t.length > 20).join('\n\n');
          }
        }
      }
      
      const chapterMatch = safeMatch(html, /<a[^>]*href="([^"]*\/chapter-1[^"]*)"[^>]*>/i);
      if (chapterMatch) firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
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
      
      const coverMatch = safeMatch(html, /<img[^>]*class="thumbnail"[^>]*src="([^"]+)"/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      // Extract first chapter URL from chapter list
      const chapterMatch = safeMatch(html, /<td[^>]*(?!class)>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>/i);
      if (chapterMatch) {
        firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
      }
    }
      
      // Extract cover image - RoyalRoad uses img with class="thumbnail" in cover-art-container
      // The image is inside <div class="cover-art-container"> with <img class="thumbnail">
      const coverMatch = safeMatch(html, /<div[^>]*class="cover-art-container"[^>]*>[\s\S]*?<img[^>]*class="thumbnail"[^>]*src="([^"]+)"[^>]*>/i) ||
                         safeMatch(html, /<img[^>]*class="thumbnail"[^>]*src="([^"]+)"[^>]*>/i) ||
                         safeMatch(html, /<figure[^>]*class="cover-art"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i) ||
                         safeMatch(html, /<img[^>]*class="cover"[^>]*src="([^"]+)"[^>]*>/i) ||
                         // Also try to get it from the meta tags
                         safeMatch(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i) ||
                         safeMatch(html, /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"[^>]*>/i);
      if (coverMatch) {
        coverUrl = makeAbsoluteUrl(coverMatch, url);
        console.log('[Scraper] RoyalRoad cover found:', coverUrl);
      } else {
        console.log('[Scraper] RoyalRoad cover not found');
      }
      
      // Extract first chapter URL - RoyalRoad has a chapters table
      // Look for the first chapter link in the chapter list
      const chapterListMatch = safeMatch(html, /<table[^>]*class="chapters"[^>]*>([\s\S]*?)<\/table>/i) ||
                               safeMatch(html, /<div[^>]*class="chapter-list"[^>]*>([\s\S]*?)<\/div>/i) ||
                               safeMatch(html, /<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      
      if (chapterListMatch) {
        // Look for the first chapter link - usually the first <a> in the list
        const firstChapterMatch = safeMatch(chapterListMatch, /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i) ||
                                  safeMatch(chapterListMatch, /<a[^>]*href="([^"]*\/chapters[^"]*)"[^>]*>/i);
        if (firstChapterMatch) {
          firstChapterUrl = makeAbsoluteUrl(firstChapterMatch, url);
          console.log('[Scraper] Found first chapter from chapter list:', firstChapterUrl);
        }
      }
      
      // If no chapter list found, try direct construction
      if (!firstChapterUrl) {
        const baseNovelUrl = url.replace(/\/$/, '');
        // RoyalRoad typically uses /chapters/ or /chapter/ in the URL structure
        if (url.includes('/fiction/')) {
          // Extract the fiction ID from the URL
          const fictionIdMatch = url.match(/\/fiction\/(\d+)/i);
          if (fictionIdMatch) {
            firstChapterUrl = `${baseNovelUrl}/chapters/1`;
            console.log('[Scraper] Constructed first chapter URL with fiction ID:', firstChapterUrl);
          }
        }
        
        // Final fallback
        if (!firstChapterUrl) {
          firstChapterUrl = `${baseNovelUrl}/chapter/1/`;
          console.log('[Scraper] Constructed first chapter URL (fallback):', firstChapterUrl);
        }
      }
    }

    // --- WUXIAWORLD.SITE (FIXED WITH ENHANCED cleanSynopsis) ---
    if (isWuxiaworld) {
      console.log('[Scraper] Wuxiaworld.site detected');
      
      const titleMatch = safeMatch(html, /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i);
      if (titleMatch) title = decodeEntities(stripTags(titleMatch));
      
      const authorMatch = safeMatch(html, /<div[^>]*class="author-content"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      // Wuxiaworld uses class="summary_content show-more" or "description-summary"
      // Try multiple selectors for the summary
      let descMatch = safeMatch(html, /<div[^>]*class="description-summary"[^>]*>([\s\S]*?)<\/div>/i);
      if (!descMatch) {
        descMatch = safeMatch(html, /<div[^>]*class="summary_content show-more[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      }
      if (!descMatch) {
        descMatch = safeMatch(html, /<div[^>]*class="[^"]*summary_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      }
      
      if (descMatch) {
        let summaryHtml = descMatch;
        
        // Extract all <p> tags first
        const paragraphs = summaryHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              // Remove the <p> tags
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              
              // Convert <br> tags to spaces (not newlines for synopsis)
              text = text.replace(/<br\s*\/?>/gi, ' ');
              
              // Decode entities
              text = decodeEntities(text);
              
              // Strip any remaining HTML tags (like <b>, <em>, etc.)
              text = stripTags(text);
              
              // Clean up extra whitespace
              text = text.replace(/\s+/g, ' ').trim();
              
              return text;
            })
            .filter(t => t.length > 0);
          
          // Join all paragraphs with a space, then clean the entire text
          let fullText = cleanedParagraphs.join(' ');
          
          // Apply the enhanced cleanSynopsis
          synopsis = cleanSynopsis(fullText);
          
          console.log('[Scraper] Wuxiaworld extracted synopsis with', cleanedParagraphs.length, 'paragraphs');
        } else {
          // Fallback: strip tags and clean
          let fallbackText = summaryHtml.replace(/<br\s*\/?>/gi, ' ');
          fallbackText = decodeEntities(stripTags(fallbackText));
          fallbackText = fallbackText.replace(/\s+/g, ' ').trim();
          synopsis = cleanSynopsis(fallbackText);
        }
      }
      
      // Wuxiaworld uses lazy loading with data-src, fallback to src
      const coverMatch = safeMatch(html, /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*data-src="([^"]+)"/i) ||
                         safeMatch(html, /<div[^>]*class="summary_image"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      // Wuxiaworld loads chapters via AJAX — extract manga_id and fetch via AJAX
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
          
          // Parse chapter links from AJAX response
          const chapterMatch = safeMatch(chapterHtml, /<a[^>]*href="([^"]*\/chapter[^"]*)"[^>]*>/i);
          if (chapterMatch) {
            firstChapterUrl = makeAbsoluteUrl(chapterMatch, url);
            console.log('[Scraper] Extracted first chapter from AJAX:', firstChapterUrl);
          }
        } catch (ajaxError: any) {
          console.warn('[Scraper] Wuxiaworld AJAX fetch failed:', ajaxError.message);
          // Fallback to constructing first chapter URL
          const baseNovelUrl = url.replace(/\/$/, '');
          firstChapterUrl = `${baseNovelUrl}/chapter-1/`;
          console.log('[Scraper] Using constructed first chapter URL:', firstChapterUrl);
        }
      }
    }

    // --- ASIANOVEL.NET ---
    if (isAsianovel) {
      console.log('[Scraper] Asianovel.net detected');
      
      // Title: uses class="story__identity-title"
      const titleMatch = safeMatch(html, /<h1[^>]*class="story__identity-title"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) title = decodeEntities(titleMatch);
      
      // Author: uses class="author" inside <div class="story__identity-meta">
      const authorMatch = safeMatch(html, /<div[^>]*class="story__identity-meta"[^>]*>[\s\S]*?<a[^>]*class="author"[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      // Cover: Located inside <figure class="story__thumbnail">, using an <img> with class="story__thumbnail-image"
      const coverMatch = safeMatch(html, /<figure[^>]*class="story__thumbnail"[^>]*>[\s\S]*?<img[^>]*class="[^"]*story__thumbnail-image[^"]*"[^>]*src="([^"]+)"[^>]*>/i) ||
                         safeMatch(html, /<figure[^>]*class="story__thumbnail"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*class="[^"]*story__thumbnail-image[^"]*"[^>]*>/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      // Synopsis: Asianovel uses <section class="story__summary content-section">
      const descMatch = safeMatch(html, /<section[^>]*class="story__summary content-section"[^>]*>([\s\S]*?)<\/section>/i);
      if (descMatch) {
        // Extract all <p> tags inside the summary
        const paragraphs = descMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          
          synopsis = cleanedParagraphs.join('\n\n');
        } else {
          synopsis = decodeEntities(stripTags(descMatch));
        }
      }
      
      // Extract the actual first chapter URL from the chapter list
      // The chapter list is in <section class="story__tab-target _current story__chapters">
      // with <ol class="chapter-group__list">
      const chapterSectionMatch = safeMatch(html, /<section[^>]*class="story__tab-target _current story__chapters"[^>]*>([\s\S]*?)<\/section>/i);
      if (chapterSectionMatch) {
        // Find the first chapter link in the list
        const firstLinkMatch = chapterSectionMatch.match(/<a[^>]*href="([^"]*\/chapter\/chapter-(\d+)\/)"[^>]*>/i);
        if (firstLinkMatch && firstLinkMatch[1]) {
          // Use the exact URL from the HTML
          firstChapterUrl = makeAbsoluteUrl(firstLinkMatch[1], url);
          console.log('[Scraper] Asianovel exact first chapter URL from HTML:', firstChapterUrl);
        }
      }
      
      // Fallback: Try to find chapter list using class="chapter-group__list"
      if (!firstChapterUrl) {
        const chapterListMatch = safeMatch(html, /<ol[^>]*class="chapter-group__list"[^>]*>([\s\S]*?)<\/ol>/i);
        if (chapterListMatch) {
          const firstLinkMatch = chapterListMatch.match(/<a[^>]*href="([^"]*\/chapter\/chapter-(\d+)\/)"[^>]*>/i);
          if (firstLinkMatch && firstLinkMatch[1]) {
            firstChapterUrl = makeAbsoluteUrl(firstLinkMatch[1], url);
            console.log('[Scraper] Asianovel exact first chapter URL from HTML (fallback):', firstChapterUrl);
          }
        }
      }
      
      // Final fallback: Construct first chapter URL
      if (!firstChapterUrl) {
        // Try to find the first chapter number from the HTML
        const chapterNumMatch = html.match(/chapter-(\d+)\//);
        if (chapterNumMatch) {
          const baseNovelUrl = url.replace(/\/$/, '');
          // Asianovel uses /chapter/chapter-{number}/ format
          firstChapterUrl = `${baseNovelUrl.replace('/story/', '/chapter/chapter-')}${chapterNumMatch[1]}/`;
          console.log('[Scraper] Asianovel constructed first chapter URL from found number:', firstChapterUrl);
        } else {
          // If we can't find a chapter number, use the story ID to construct a reasonable URL
          const baseNovelUrl = url.replace(/\/$/, '');
          firstChapterUrl = `${baseNovelUrl.replace('/story/', '/chapter/chapter-')}1/`;
          console.log('[Scraper] Asianovel constructed first chapter URL (fallback):', firstChapterUrl);
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
      firstChapterUrl
    };
  } catch (error: any) {
    console.error('[Scraper] Error:', error.message);
    throw new Error(`Failed to fetch novel: ${error.message}`);
  }
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
    const isFreeWebNovel = domainLower.includes('freewebnovel') || domainLower.includes('bednovel');
    const isNovelBin = domainLower.includes('novelbin');
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
    
    if (isNovelBin) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="title"[^>]*itemprop="headline"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h1[^>]*itemprop="headline"[^>]*class="title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+/gi, '').trim();
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

    // --- ROYALROAD CHAPTER TITLE EXTRACTION ---
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

    // --- WUXIAWORLD CHAPTER TITLE AND CONTENT EXTRACTION (IMPROVED) ---
    if (isWuxiaworld) {
      // Title: uses class="post-title" or similar
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
      
      // Content: Wuxiaworld uses <div class="chapter-content"> or similar
      let contentHtml = null;
      
      // Try multiple selectors for Wuxiaworld content
      const contentMatch1 = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch2 = safeMatch(html, /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch3 = safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch4 = safeMatch(html, /<div[^>]*class="text-left"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch5 = safeMatch(html, /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch6 = safeMatch(html, /<article[^>]*class="chapter"[^>]*>([\s\S]*?)<\/article>/i);
      
      contentHtml = contentMatch1 || contentMatch2 || contentMatch3 || contentMatch4 || contentMatch5 || contentMatch6;
      
      if (contentHtml) {
        // Extract paragraphs from the content
        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              // Convert <br> tags to double newlines
              text = text.replace(/<br\s*\/?>/gi, '\n\n');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          
          // Join paragraphs with double newlines
          const extractedContent = cleanedParagraphs.join('\n\n');
          if (extractedContent.length > 0) {
            // Store for later use
          }
        } else {
          // No <p> tags found, try to extract text with <br> handling
          let text = decodeEntities(stripTags(contentHtml));
          // Replace any remaining <br> tags with newlines
          text = text.replace(/<br\s*\/?>/gi, '\n\n');
          // Store for later use
        }
      }
    }

    // --- ASIANOVEL CHAPTER TITLE AND CONTENT EXTRACTION ---
    if (isAsianovel) {
      // Title: uses class="chapter-title"
      const titleMatch = safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i) ||
                         safeMatch(html, /<h1[^>]*itemprop="headline"[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        // Remove "Chapter X" prefix if present
        rawTitle = rawTitle.replace(/^Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
      
      // Content: Asianovel uses <div class="chapter-content"> or similar
      // Let's try multiple selectors
      let contentHtml = null;
      
      // Try to find content in various possible containers
      const contentMatch1 = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch2 = safeMatch(html, /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch3 = safeMatch(html, /<div[^>]*class="content"[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch4 = safeMatch(html, /<div[^>]*class="story__content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch5 = safeMatch(html, /<article[^>]*class="chapter"[^>]*>([\s\S]*?)<\/article>/i);
      
      contentHtml = contentMatch1 || contentMatch2 || contentMatch3 || contentMatch4 || contentMatch5;
      
      if (contentHtml) {
        // Extract paragraphs from the content
        const paragraphs = contentHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              // Handle <br> tags - convert to newlines
              text = text.replace(/<br\s*\/?>/gi, '\n');
              text = decodeEntities(text);
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          
          // If we have content from a content div, use it directly
          const contentText = cleanedParagraphs.join('\n\n');
          if (contentText.length > 0) {
            // We'll assign this to content later
            // Store in a variable to use later
            const extractedContent = contentText;
            // We'll handle this after the main paragraph extraction
          }
        } else {
          // Fallback: extract all text from the content div
          const extractedContent = decodeEntities(stripTags(contentHtml));
          if (extractedContent.length > 0) {
            // Store for later use
          }
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
    
    // For Asianovel, we already extracted content earlier
    if (isAsianovel) {
      // Check if we have content from the Asianovel-specific extraction
      // We'll re-extract here to be safe
      const contentMatch1 = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch2 = safeMatch(html, /<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch3 = safeMatch(html, /<div[^>]*class="content"[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i);
      const contentMatch4 = safeMatch(html, /<div[^>]*class="story__content"[^>]*>([\s\S]*?)<\/div>/i);
      
      const contentHtml = contentMatch1 || contentMatch2 || contentMatch3 || contentMatch4;
      
      if (contentHtml) {
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
        } else {
          content = decodeEntities(stripTags(contentHtml));
        }
      }
    }
    
    // For Wuxiaworld, extract content using specific selectors
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
    
    // If no content yet, use the general extraction
    if (!content) {
      if (isNovelBin && validParagraphs.length > 0) {
        const junkPhrases = [
          'error loading comments',
          'please try again later',
          'total responses',
          'load comments',
          '~Novelⅈght~',
          'login to comment',
          'post a comment',
          'report error',
          'novelbin.com',
          'novelbin.me',
          'Community',
          'Share your thoughts',
          'react to the',
          'latest chapter',
          'or reply',
          'to other readers',
          'Thoughful comments',
          'make this page',
          'more useful',
          'for everyone.'
        ];
        const filtered = validParagraphs.filter(text => {
          const lower = text.toLowerCase();
          return !junkPhrases.some(phrase => lower.includes(phrase));
        });
        content = filtered.join('\n\n') || validParagraphs.join('\n\n');
      } else if (isFreeWebNovel && validParagraphs.length > 0) {
        const junkPhrases = [
          'panda',
          'novɐ1',
          'com',
          'freewebnovel.com',
          'freewebnovel',
          '𝕗𝚛𝚎𝚎𝐰𝗲𝗯𝗻𝚘𝚟𝚎𝗹.𝕔𝐨𝕞',
          'bednovel.com',
          'bednovel',
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
    
    // If still no content, try fallback content extraction
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
    
    const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    
    while ((linkMatch = linkRegex.exec(html)) !== null) {
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

/**
 * Downloads all chapters of a novel by following the "next chapter" links.
 * Saves each chapter as soon as it's fetched, allowing incremental progress.
 *
 * @param startUrl - URL of the first chapter (e.g., from `firstChapterUrl`)
 * @param novelId - Unique identifier for the novel (used in the save callback)
 * @param saveChapter - Async function to store a chapter: (novelId, chapterIndex, title, content) => Promise<void>
 * @param onProgress - Optional callback for progress updates: (chapterNumber, title) => void
 * @param delayMs - Milliseconds to wait between chapter requests (default 500)
 * @returns Promise that resolves when all chapters are downloaded
 */
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
