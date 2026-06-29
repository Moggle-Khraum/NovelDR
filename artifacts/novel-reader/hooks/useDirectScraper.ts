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

// Create axios instance with HTTP/1.1 preference via headers
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
  } catch (err) {
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

// Fetch with fallback to proxy for FreeWebNovel
const fetchWithFallback = async (url: string, isFreeWebNovel: boolean): Promise<string> => {
  if (isFreeWebNovel) {
    console.log('[Scraper] FreeWebNovel - using proxy for HTTP/1.1');
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    try {
      const response = await httpClient.get(proxyUrl);
      return response.data;
    } catch (proxyError) {
      console.warn('[Scraper] Proxy failed, trying direct:', proxyError.message);
      const directResponse = await httpClient.get(url);
      return directResponse.data;
    }
  }
  
  try {
    const response = await httpClient.get(url);
    return response.data;
  } catch (directError) {
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
    const isRoyalRoad = domainLower.includes('royalroad');
    const isWuxiaworld = domainLower.includes('wuxiaworld.site');
    
    const html = await fetchWithFallback(url, isFreeWebNovel);
    
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

    // --- WUXIAWORLD.SITE ---
    if (isWuxiaworld) {
      console.log('[Scraper] Wuxiaworld.site detected');
      
      const titleMatch = safeMatch(html, /<div[^>]*class="post-title"[^>]*>([\s\S]*?)<\/div>/i);
      if (titleMatch) title = decodeEntities(stripTags(titleMatch));
      
      const authorMatch = safeMatch(html, /<div[^>]*class="author-content"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (authorMatch) author = decodeEntities(authorMatch);
      
      // Wuxiaworld uses class="summary__content show-more"
      const descMatch = safeMatch(html, /<div[^>]*class="[^"]*summary__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (descMatch) {
        let summaryHtml = descMatch;
        
        // STEP 1: Remove the boilerplate header text
        summaryHtml = summaryHtml.replace(/You’re Reading.*?on WuxiaWorld\.Site/i, '').trim();
        
        // STEP 2: Convert <br> to actual newlines before stripping other tags
        summaryHtml = summaryHtml.replace(/<br\s*\/?>/gi, '\n');
        
        // STEP 3: Extract paragraphs safely, preserving the newlines from <br> tags
        const paragraphs = summaryHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (paragraphs) {
          const cleanedParagraphs = paragraphs
            .map(p => {
              // Remove <p> tags, but DO NOT strip internal <br> tags yet
              let text = p.replace(/<p[^>]*>/i, '').replace(/<\/p>/i, '');
              // Decode entities first
              text = decodeEntities(text);
              // Now strip ALL tags (this will turn any remaining <br> into spaces, which is fine since we already created \n above)
              text = stripTags(text);
              return text.trim();
            })
            .filter(t => t.length > 0);
          
          // Join with double newline to ensure proper paragraph spacing
          synopsis = cleanedParagraphs.join('\n\n');
        } else {
          // Fallback if no <p> tags are found
          let fallbackText = decodeEntities(stripTags(summaryHtml));
          synopsis = fallbackText;
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
        } catch (ajaxError) {
          console.warn('[Scraper] Wuxiaworld AJAX fetch failed:', ajaxError.message);
          // Fallback to constructing first chapter URL
          const baseNovelUrl = url.replace(/\/$/, '');
          firstChapterUrl = `${baseNovelUrl}/chapter-1/`;
          console.log('[Scraper] Using constructed first chapter URL:', firstChapterUrl);
        }
      }
    }
    
    console.log('[Scraper] Found first chapter:', firstChapterUrl);
    
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
    
    const { html, fetchMethod, httpStatus, contentType } = isLightNovelWorld
      ? await fetchLightNovelWorld(url)
      : { html: await fetchWithFallback(url, isFreeWebNovel), fetchMethod: 'fetch' as const, httpStatus: 200, contentType: 'text/html' };
    
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

    if (isRoyalRoad) {
      const titleMatch = safeMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
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
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(stripTags(titleMatch)).trim().replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]?\s*/gi, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
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
    } else if (isWuxiaworld && validParagraphs.length > 0) {
      const junkPhrases = [
        'ad',
        'advertisement',
      ];
      const filtered = validParagraphs.filter(text => {
        const lower = text.toLowerCase();
        return !junkPhrases.some(phrase => lower.includes(phrase));
      });
      content = filtered.join('\n\n') || validParagraphs.join('\n\n');
    } else if (isLightNovelPub && validParagraphs.length > 0) {
      // LightNovelPub is clean, minimal filtering needed
      const junkPhrases = [
        'light novel pub',
        'lightnovelpub',
        'read novel free',
      ];
      const filtered = validParagraphs.filter(text => {
        const lower = text.toLowerCase();
        return !junkPhrases.some(phrase => lower.includes(phrase)) && text.length > 20;
      });
      content = filtered.join('\n\n') || validParagraphs.join('\n\n');
    } else {
      content = validParagraphs.join('\n\n');
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
