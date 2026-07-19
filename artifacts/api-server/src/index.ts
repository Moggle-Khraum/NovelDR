import express from "express";
import cors from "cors";
import { parse } from "node-html-parser";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

// Helper functions (mirror your Python code)
const ensureAbsoluteUrl = (url: string, baseUrl: string): string => {
  if (!url) return baseUrl;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) {
    try {
      const parsed = new URL(baseUrl);
      return `${parsed.protocol}//${parsed.host}${url}`;
    } catch {
      return url;
    }
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
};

const extractTitleFromUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    let path = parsedUrl.pathname;

    if (path.endsWith(".html")) {
      path = path.slice(0, -5);
    }

    const pathParts = path.split("/").filter((part) => part);

    let novelSlug = null;
    for (const part of pathParts) {
      if (part && !part.toLowerCase().includes("chapter") && part.length > 5) {
        novelSlug = part;
        break;
      }
    }

    if (!novelSlug && pathParts.length > 0) {
      novelSlug = pathParts[pathParts.length - 1];
    }

    if (novelSlug) {
      novelSlug = novelSlug.replace(/^\d+[\s\-\.]+/, "");
      const title = novelSlug.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
      return title
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    return "Unknown Novel";
  } catch (error) {
    return "Unknown Novel";
  }
};

const getFirstChapterUrl = (html: string, baseUrl: string): string | null => {
  const root = parse(html);

  // Try chapter containers (ReadNovelFull, NovelFull)
  const chapterContainer = root.querySelector("#tab-chapters, #list-chapter");
  if (chapterContainer) {
    const chapterUl = chapterContainer.querySelector("ul.list-chapter");
    if (chapterUl) {
      const firstLi = chapterUl.querySelector("li");
      if (firstLi) {
        const firstA = firstLi.querySelector("a");
        if (firstA && firstA.getAttribute("href")) {
          return ensureAbsoluteUrl(firstA.getAttribute("href"), baseUrl);
        }
      }
    }
  }

  // Try FreeWebNovel
  const ul = root.querySelector("ul.ul-list5");
  if (ul) {
    const firstLi = ul.querySelector("li");
    if (firstLi) {
      const firstA = firstLi.querySelector("a");
      if (firstA && firstA.getAttribute("href")) {
        return ensureAbsoluteUrl(firstA.getAttribute("href"), baseUrl);
      }
    }
  }

  // Fallback: find any chapter 1 link
  const allLinks = root.querySelectorAll("a");
  for (const link of allLinks) {
    const href = link.getAttribute("href")?.toLowerCase() || "";
    const text = link.text?.toLowerCase() || "";
    if (
      (href.includes("chapter-1") ||
        href.includes("chapter/1") ||
        text.includes("chapter 1")) &&
      !href.includes("next") &&
      !href.includes("last")
    ) {
      return ensureAbsoluteUrl(link.getAttribute("href"), baseUrl);
    }
  }

  return null;
};

// API Endpoints
app.post("/api/novel/meta", async (req, res) => {
  try {
    const { url } = req.body;
    console.log("[API] Fetching novel meta:", url);

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 15000,
    });

    const html = response.data;
    const root = parse(html);

    const domainLower = url.toLowerCase();
    const isReadNovelFull = domainLower.includes("readnovelfull");
    const isNovelFull = domainLower.includes("novelfull") && !isReadNovelFull;
    const isFreeWebNovel = domainLower.includes("freewebnovel");

    // Extract title
    let title = extractTitleFromUrl(url);

    if (isReadNovelFull || isNovelFull) {
      const titleElem = root.querySelector("h3.title, h1.title, .book-title");
      if (titleElem) title = titleElem.text?.trim() || title;
    } else if (isFreeWebNovel) {
      const titleElem = root.querySelector("h1.novel-title, h1.title");
      if (titleElem) title = titleElem.text?.trim() || title;
    }

    // Extract author
    let author = "Unknown Author";

    if (isReadNovelFull) {
      const authorSpan = root.querySelector('span[itemprop="author"]');
      if (authorSpan) {
        const authorMeta = authorSpan.querySelector('meta[itemprop="name"]');
        if (authorMeta)
          author = authorMeta.getAttribute("content") || "Unknown";
      }
    } else if (isNovelFull) {
      const infoDiv = root.querySelector("div.info");
      if (infoDiv) {
        const h3Elements = infoDiv.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.text?.includes("Author:")) {
            const authorLink = h3.nextElementSibling?.querySelector("a");
            if (authorLink) author = authorLink.text?.trim() || "Unknown";
            break;
          }
        }
      }
    } else if (isFreeWebNovel) {
      const authorLink = root.querySelector("div.item div.right a.a1");
      if (authorLink) author = authorLink.text?.trim() || "Unknown";
    }

    // Extract synopsis
    let synopsis = "No summary available.";

    if (isReadNovelFull) {
      const descDiv = root.querySelector('div[itemprop="description"]');
      if (descDiv) {
        const paragraphs = descDiv.querySelectorAll("p");
        if (paragraphs.length > 0) {
          const texts = paragraphs
            .map((p) => p.text?.trim() || "")
            .filter((t) => t);
          synopsis = texts.join("\n\n");
        } else {
          synopsis = descDiv.text?.trim() || synopsis;
        }
      }
    } else if (isNovelFull) {
      const descDiv = root.querySelector("div.desc-text");
      if (descDiv) {
        const paragraphs = descDiv.querySelectorAll("p");
        if (paragraphs.length > 0) {
          const texts = paragraphs
            .map((p) => p.text?.trim() || "")
            .filter((t) => t);
          synopsis = texts.join("\n\n");
        } else {
          synopsis = descDiv.text?.trim() || synopsis;
        }
      }
    } else if (isFreeWebNovel) {
      const descDiv = root.querySelector("div.m-desc");
      if (descDiv) {
        const inner = descDiv.querySelector("div.inner");
        if (inner) {
          const paragraphs = inner.querySelectorAll("p");
          if (paragraphs.length > 0) {
            const texts = paragraphs
              .map((p) => p.text?.trim() || "")
              .filter((t) => t);
            synopsis = texts.join("\n\n");
          }
        }
      }
    }

    // Extract cover URL
    let coverUrl = "";
    const coverImg = root.querySelector("div.book img, div.pic img");
    if (coverImg) {
      const src = coverImg.getAttribute("src");
      if (src) coverUrl = ensureAbsoluteUrl(src, url);
    }

    // Get first chapter URL
    const firstChapterUrl = getFirstChapterUrl(html, url);

    console.log("[API] Success:", { title, author, firstChapterUrl });

    res.json({
      title,
      author,
      synopsis,
      coverUrl,
      firstChapterUrl,
    });
  } catch (error: any) {
    console.error("[API] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/novel/next-chapter", async (req, res) => {
  try {
    const { url, chapterNum } = req.body;
    console.log("[API] Fetching chapter:", url, "Chapter", chapterNum);

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 15000,
    });

    const html = response.data;
    const root = parse(html);

    // Extract chapter title
    let title = `Chapter ${chapterNum}`;
    const titleSelectors = [
      "h1.chapter-title",
      "h2.chapter-title",
      "span.chapter-title",
      "h1.chr-title",
      "h2.chr-title",
      "span.chr-title",
      "h1.entry-title",
      "h2.entry-title",
      "span.entry-title",
    ];

    for (const selector of titleSelectors) {
      const titleElem = root.querySelector(selector);
      if (titleElem) {
        const rawTitle = titleElem.text?.trim() || "";
        const cleanTitle = rawTitle
          .replace(/^Chapter\s*\d+\s*[:\-]*\s*/i, "")
          .trim();
        if (cleanTitle && cleanTitle.length > 0) {
          title = `Chapter ${chapterNum}: ${cleanTitle}`;
        }
        break;
      }
    }

    // Extract content (all paragraphs)
    const paragraphs = root.querySelectorAll("p");
    const validParagraphs: string[] = [];

    for (const p of paragraphs) {
      const text = p.text?.trim() || "";
      if (text.length > 5 && !text.toLowerCase().includes("next chapter")) {
        validParagraphs.push(text);
      }
    }

    const content = validParagraphs.join("\n\n");

    // Find next chapter URL
    let nextUrl: string | null = null;
    const allLinks = root.querySelectorAll("a");

    for (const link of allLinks) {
      const text = link.text?.toLowerCase() || "";
      const href = link.getAttribute("href");
      const className = link.getAttribute("class")?.toLowerCase() || "";
      const id = link.getAttribute("id")?.toLowerCase() || "";

      if (
        href &&
        (text.includes("next") ||
          text.includes("next chapter") ||
          className.includes("next") ||
          id.includes("next"))
      ) {
        nextUrl = ensureAbsoluteUrl(href, url);
        break;
      }
    }

    console.log("[API] Chapter fetched:", {
      title,
      hasContent: !!content,
      nextUrl,
    });

    res.json({
      url,
      title,
      content: content || "No content available.",
      nextUrl,
    });
  } catch (error: any) {
    console.error("[API] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[API] Server running on port ${PORT}`);
});
