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
      
      // Author extraction
      if (isReadNovelFull) {
        const authorMatch = safeMatch(html, /<span[^>]*itemprop="author"[^>]*>.*?<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i);
        if (authorMatch) author = decodeEntities(authorMatch);
      }
      
      // All Novelfull-style sites (novelfull.net, novelfull.com, allnovel.org, novgo.net) use the same info div
      if (isNovelFullNet || isNovelFullCom || isAllNovel || isNovgo) {
        const authorMatch = safeMatch(html, /<div[^>]*class="info"[^>]*>[\s\S]*?<h3>Author:<\/h3>\s*<a[^>]*>([^<]+)<\/a>/i);
        if (authorMatch) author = decodeEntities(authorMatch);
      }

      // --- READNOVELFULL SYNOPSIS ---
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
      
      // --- NOVELFULL (without .com) SYNOPSIS ---
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
      
      // --- NOVELFULL.COM SYNOPSIS ---
      if (isNovelFullCom) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) {
                cleanedParagraphs.push(text.trim());
              }
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      // --- ALLNOVEL SYNOPSIS ---
      if (isAllNovel) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) {
                cleanedParagraphs.push(text.trim());
              }
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      // --- NOVGO SYNOPSIS ---
      if (isNovgo) {
        const descMatch = safeMatch(html, /<div[^>]*class="desc-text"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) {
          const paragraphs = descMatch.match(/<p[^>]*>(.*?)<\/p>/gis);
          if (paragraphs) {
            const cleanedParagraphs = [];
            for (const p of paragraphs) {
              let text = p.replace(/<\/?p[^>]*>/gi, '');
              text = decodeEntities(stripTags(text));
              if (text.trim()) {
                cleanedParagraphs.push(text.trim());
              }
            }
            synopsis = cleanedParagraphs.join('\n\n');
          } else {
            synopsis = decodeEntities(stripTags(descMatch));
          }
        }
      }
      
      // Cover image
      const coverMatch = safeMatch(html, /<div[^>]*class="book"[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*>/i);
      if (coverMatch) coverUrl = makeAbsoluteUrl(coverMatch, url);
      
      // First chapter URL
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
      
      // Extract synopsis by ID directly (most reliable)
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
        // Fallback to class-based matching
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
      
      const coverMatch = safeMatch(html, /<img[^>]*class="novel-cover"[^>]*src="([^"]+)"/i) ||
                         safeMatch(html, /<img[^>]*src="([^"]+)"[^>]*class="novel-cover"/i);
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
    
    const html = await fetchWithFallback(url, isFreeWebNovel);
    
    // Default title
    let title = `Chapter ${chapterNum}`;
    let skipCleanup = false;
    
    // Extract real chapter title
    if (isReadNovelFull || isNovelFullNet || isNovelFullCom || isAllNovel || isNovgo) {
      const titleMatch = safeMatch(html, /<span[^>]*class="(?:chr-text|chapter-text)"[^>]*>([^<]+)<\/span>/i) ||
                         safeMatch(html, /<a[^>]*class="(?:chr-title|chapter-title)"[^>]*title="([^"]+)"/i) ||
                         safeMatch(html, /<(?:h2|h3)[^>]*class="(?:chapter-title|title|chapter)"[^>]*>([^<]+)<\/(?:h2|h3)>/i) ||
                         safeMatch(html, /<(?:h2|h3)[^>]*>([^<]*Chapter[^<]*)<\/(?:h2|h3)>/i);
   if (titleMatch) {
     let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
     rawTitle = rawTitle.replace(/^.*Chapter\s+\d+(\s+\d+)?\s*[:.\-–—]?\s*/i, '').trim();
     // Remove any leading comma and spaces left over
     rawTitle = rawTitle.replace(/^[\s,]+/, '').trim();
     title = `Chapter ${chapterNum}: ${rawTitle}`;
     skipCleanup = true;
    }
  }
        
    //FreeWebNovel Title Extractor
    if (isFreeWebNovel) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="tit"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h4[^>]*>([^<]*Chapter[^<]*)<\/h4>/i) ||
                         safeMatch(html, /<h2[^>]*>([^<]*Chapter[^<]*)<\/h2>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        // Remove all "Chapter X:" prefixes
        rawTitle = rawTitle.replace(/Chapter\s+\d+\s*[:.\-–—]\s*/gi, '').trim();
        // Remove stray duplicate number (e.g., "15 :")
        rawTitle = rawTitle.replace(new RegExp(`^\\s*${chapterNum}\\s*[:.\\-–—]?\\s*`, 'i'), '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }


    // Novelbin
    if (isNovelBin) {
      const titleMatch = safeMatch(html, /<span[^>]*class="chr-text"[^>]*>([^<]+)<\/span>/i) ||
                         safeMatch(html, /<a[^>]*class="chr-title"[^>]*title="([^"]+)"/i) ||
                         safeMatch(html, /<h3[^>]*class="title"[^>]*>([^<]+)<\/h3>/i) ||
                         safeMatch(html, /<(?:h2|h3)[^>]*>([^<]*Chapter[^<]*)<\/(?:h2|h3)>/i) ||
                         safeMatch(html, /<a[^>]*class="chr-title"[^>]*>([^<]+)<\/a>/i);
      if (titleMatch) {
        let rawTitle = decodeEntities(titleMatch.trim()).replace(/\s+/g, ' ').trim();
        rawTitle = rawTitle.replace(/^.*Chapter\s+\d+(\s+\d+)?\s*[:.\-–—]?\s*/i, '').trim();
        title = `Chapter ${chapterNum}: ${rawTitle}`;
        skipCleanup = true;
      }
    }

    //LightNovelWorld
    if (isLightNovelWorld) {
      const titleMatch = safeMatch(html, /<h1[^>]*class="chapter-title"[^>]*>([^<]+)<\/h1>/i) ||
                         safeMatch(html, /<h2[^>]*class="chapter-title"[^>]*>([^<]+)<\/h2>/i) ||
                         safeMatch(html, /<h1[^>]*>([^<]*Chapter[^<]*)<\/h1>/i) ||
                         safeMatch(html, /<span[^>]*class="chapter-title"[^>]*>([^<]+)<\/span>/i);
      if (titleMatch) title = decodeEntities(titleMatch.trim());
    }
    
    // Generic fallback
    if (title === `Chapter ${chapterNum}`) {
      const genericMatch = safeMatch(html, /<(?:h1|h2|h3)[^>]*>([^<]*(?:Chapter|Ch\.|Volume|Vol\.|Part|Book)[^<]*)<\/(?:h1|h2|h3)>/i);
      if (genericMatch) title = decodeEntities(genericMatch.trim());
    }
    
    // Clean up the title (skip if already processed by a site-specific block)
    if (!skipCleanup) {
      title = title
        .replace(/\s+/g, ' ')
        .replace(/^\s*Chapter\s+(\d+)\s*[:.-]?\s*/i, 'Chapter $1: ')
        .trim();
    }
    
    // First line fallback
    if (title === `Chapter ${chapterNum}` || title.match(/^Chapter\s+\d+$/i)) {
      const firstLineMatch = html.match(/<p[^>]*>([^<]*Chapter[^<]*)<\/p>/i);
      if (firstLineMatch) {
        const extractedTitle = decodeEntities(stripTags(firstLineMatch[1])).trim();
        if (extractedTitle.length > 0 && extractedTitle.length < 100) {
          title = extractedTitle;
        }
      }
    }
    
    console.log('[Scraper] Extracted title:', title);
    
    // Extract chapter content
    let paragraphMatches: string[] | null = null;
    
    if (isFreeWebNovel) {
      const containerMatch = html.match(/<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                             html.match(/<div[^>]*id="chapter-container"[^>]*>([\s\S]*?)<\/div>/i);
      if (containerMatch) {
        paragraphMatches = containerMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gis);
      }
    }
    
    if (isLightNovelWorld && !paragraphMatches) {
      const containerMatch = html.match(/<div[^>]*id="chapterText"[^>]*>([\s\S]*?)<\/div>/i) ||
                             html.match(/<div[^>]*class="chapter-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (containerMatch) {
        let cleaned = containerMatch[1]
          .replace(/<div[^>]*class="chapter-ad-container"[^>]*>[\s\S]*?<\/div>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        cleaned = cleaned.replace(/<div[^>]*class="text-to-speech[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
        cleaned = cleaned.replace(/<div[^>]*class="cta-banner[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
        paragraphMatches = cleaned.match(/<p[^>]*>([\s\S]*?)<\/p>/gis);
      }
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
    } else if (isLightNovelWorld && validParagraphs.length > 0) {
      const junkPhrases = [
        'text-to-speech is here',
        'create a free account',
        'unlock the full experience',
        'post comment',
        'verification code',
        'resend code',
        'staff account detected',
        'forgot password',
        'reset password',
        'confirm password',
        'username password',
        'mark as spoiler',
        'poll options',
        'add option',
        'cancel post',
        'posting...',
        'verifying...',
        'sending...',
        'resetting...',
        'window.initializecomments',
        'light novel world',
        'your gateway to infinite stories',
        '© 2025 light novel world',
        'loading chapters...',
        'chapter comments',
        'login to comment',
        'please follow common sense when posting comments',
        'spam, phishing, or any sort of suspicious comment will be deleted',
      ];
      
      const filtered = validParagraphs.filter(text => {
        const lower = text.toLowerCase();
        for (const phrase of junkPhrases) {
          if (lower.includes(phrase)) return false;
        }
        if (text.length < 20) return false;
        return true;
      });
      
      let startIdx = 0;
      while (startIdx < filtered.length && filtered[startIdx].length < 80) startIdx++;
      let endIdx = filtered.length - 1;
      while (endIdx >= 0 && filtered[endIdx].toLowerCase().includes('comment')) endIdx--;
      
      const cleaned = filtered.slice(startIdx, endIdx + 1);
      content = cleaned.join('\n\n');
      if (!content.trim()) {
        content = validParagraphs.join('\n\n');
      }
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
    } else {
      content = validParagraphs.join('\n\n');
    }
    
    if (!content) {
      const contentMatch = safeMatch(html, /<div[^>]*class="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                           safeMatch(html, /<article[^>]*>([\s\S]*?)<\/article>/i);
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
