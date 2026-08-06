import { Router, type IRouter } from "express";
import axios from "axios";
import { parse } from "node-html-parser";
import { URL } from "url";

const router: IRouter = Router();

function validateExternalHttpUrl(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === "localhost" || host === "::1" || host === "127.0.0.1") {
    return null;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map((n) => Number(n));
    if (
      octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      const [a, b] = octets;
      const isPrivate =
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 0 && b === 0);
      if (isPrivate) return null;
    }
  }

  return parsed.toString();
}

const httpClient = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  },
});

function ensureAbsoluteUrl(href: string, baseUrl: string): string {
  try {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    const base = new URL(baseUrl);
    if (href.startsWith("/")) return `${base.protocol}//${base.host}${href}`;
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function detectSite(url: string) {
  const lower = url.toLowerCase();
  return {
    isReadNovelFull: lower.includes("readnovelfull"),
    isNovelFull:
      lower.includes("novelfull") && !lower.includes("readnovelfull"),
    isFreeWebNovel: lower.includes("freewebnovel"),
    isChapterPage: lower.includes("chapter"),
  };
}

function extractTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    if (path.endsWith(".html")) path = path.slice(0, -5);
    const parts = path.split("/").filter(Boolean);
    let slug = parts.find(
      (p) => !p.toLowerCase().includes("chapter") && p.length > 5,
    );
    if (!slug) slug = parts[parts.length - 1] || "Unknown Novel";
    slug = slug.replace(/^\d+[\s\-\.]+/, "");
    return slug
      .replace(/-/g, " ")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  } catch {
    return "Unknown Novel";
  }
}

function getNovelMainPageUrl(html: string, chapterUrl: string): string | null {
  const root = parse(html);
  const breadcrumb = root.querySelector("ol.breadcrumb");
  if (breadcrumb) {
    const links = breadcrumb.querySelectorAll("a");
    if (links.length >= 2) {
      const href = links[1].getAttribute("href");
      if (href) return ensureAbsoluteUrl(href, chapterUrl);
    }
  }
  for (const a of root.querySelectorAll("a")) {
    const text = (a.text || "").toLowerCase();
    if (
      text.includes("back to novel") ||
      text.includes("novel home") ||
      text.includes("main page")
    ) {
      const href = a.getAttribute("href");
      if (href) return ensureAbsoluteUrl(href, chapterUrl);
    }
  }
  return null;
}

function getFirstChapterUrl(html: string, baseUrl: string): string | null {
  const root = parse(html);
  const container =
    root.querySelector("#tab-chapters") || root.querySelector("#list-chapter");
  if (container) {
    const ul = container.querySelector("ul.list-chapter");
    if (ul) {
      const first = ul.querySelector("li a");
      if (first) {
        const href = first.getAttribute("href");
        if (href) return ensureAbsoluteUrl(href, baseUrl);
      }
    }
  }
  for (const a of root.querySelectorAll("a")) {
    const href = (a.getAttribute("href") || "").toLowerCase();
    const text = (a.text || "").toLowerCase();
    if (
      (href.includes("chapter-1") ||
        href.includes("chapter-01") ||
        href.includes("chapter1") ||
        text.includes("chapter 1")) &&
      !href.includes("next") &&
      !text.includes("next")
    ) {
      const realHref = a.getAttribute("href");
      if (realHref) return ensureAbsoluteUrl(realHref, baseUrl);
    }
  }
  return null;
}

function extractNextChapterUrl(
  html: string,
  currentUrl: string,
): string | null {
  const root = parse(html);
  for (const a of root.querySelectorAll("a")) {
    const text = (a.text || "").toLowerCase().trim();
    const cls = (a.getAttribute("class") || "").toLowerCase();
    const id = (a.getAttribute("id") || "").toLowerCase();
    if (
      text === "next chapter" ||
      text === "next" ||
      cls.includes("next") ||
      id.includes("next")
    ) {
      const href = a.getAttribute("href");
      if (href && !href.includes("javascript") && href !== "#") {
        return ensureAbsoluteUrl(href, currentUrl);
      }
    }
  }
  return null;
}

function extractChapterContent(html: string): string {
  const root = parse(html);
  const paragraphs = root.querySelectorAll("p");
  return paragraphs
    .map((p) => p.text.trim())
    .filter((t) => t.length > 5)
    .join("\n\n");
}

function extractChapterTitle(html: string, chapterNum: number): string {
  const root = parse(html);
  const titleEl =
    root.querySelector(".chapter-title") ||
    root.querySelector(".chr-title") ||
    root.querySelector(".entry-title") ||
    root.querySelector("h1") ||
    root.querySelector("h2");
  if (titleEl) {
    const raw = titleEl.text.trim();
    const clean = raw.replace(/^Chapter\s*\d+\s*[:\-]*\s*/i, "").trim();
    if (clean) return `Chapter ${chapterNum}: ${clean}`;
  }
  return `Chapter ${chapterNum}`;
}

function extractNovelMeta(
  html: string,
  baseUrl: string,
  site: ReturnType<typeof detectSite>,
) {
  const root = parse(html);

  let coverUrl = "";
  const picDiv =
    root.querySelector("div.pic img") || root.querySelector("div.book img");
  if (picDiv) {
    const src =
      picDiv.getAttribute("src") || picDiv.getAttribute("data-src") || "";
    if (src) coverUrl = ensureAbsoluteUrl(src, baseUrl);
  }

  let author = "Unknown Author";
  if (site.isReadNovelFull) {
    const authorMeta = root.querySelector(
      "[itemprop='author'] [itemprop='name']",
    );
    if (authorMeta) author = authorMeta.getAttribute("content") || author;
  } else if (site.isNovelFull) {
    const infoDiv = root.querySelector("div.info");
    if (infoDiv) {
      const authLink = infoDiv.querySelector("a");
      if (authLink) author = authLink.text.trim() || author;
    }
  } else if (site.isFreeWebNovel) {
    const authorLink = root.querySelector(".right .a1");
    if (authorLink) author = authorLink.text.trim() || author;
  }

  let synopsis = "No summary available.";
  if (site.isReadNovelFull) {
    const descDiv = root.querySelector("[itemprop='description']");
    if (descDiv) {
      const paras = descDiv.querySelectorAll("p");
      synopsis =
        paras.length > 0
          ? paras
              .map((p) => p.text.trim())
              .filter(Boolean)
              .join("\n\n")
          : descDiv.text.trim();
    }
  } else if (site.isNovelFull) {
    const descDiv = root.querySelector("div.desc-text");
    if (descDiv) {
      const paras = descDiv.querySelectorAll("p");
      synopsis =
        paras.length > 0
          ? paras
              .map((p) => p.text.trim())
              .filter(Boolean)
              .join("\n\n")
          : descDiv.text.trim();
    }
  } else if (site.isFreeWebNovel) {
    const descDiv = root.querySelector("div.m-desc .inner");
    if (descDiv) {
      const paras = descDiv.querySelectorAll("p");
      synopsis =
        paras.length > 0
          ? paras
              .map((p) => p.text.trim())
              .filter(Boolean)
              .join("\n\n")
          : descDiv.text.trim();
    }
  }

  return { coverUrl, author, synopsis };
}

router.post("/api/novel/scrape-chapter", async (req, res) => {
  const { url } = req.body as { url: string };
  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }
  try {
    const response = await httpClient.get(url);
    const html = response.data as string;
    const content = extractChapterContent(html);
    const chapterNum = parseInt(
      (url.match(/chapter[-_]?(\d+)/i) || [])[1] || "1",
      10,
    );
    const title = extractChapterTitle(html, chapterNum);
    const nextUrl = extractNextChapterUrl(html, url);
    res.json({ title, content, nextUrl });
  } catch (e: any) {
    req.log.error({ err: e }, "Failed to scrape chapter");
    res.status(500).json({ error: e.message || "Failed to fetch chapter" });
  }
});

router.post("/api/novel/meta", async (req, res) => {
  const { url } = req.body as { url: string };
  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }
  try {
    const site = detectSite(url);
    const title = extractTitleFromUrl(url);

    let pageUrl = url;
    let html: string;

    const resp = await httpClient.get(url);
    html = resp.data as string;

    if (site.isChapterPage) {
      const novelUrl = getNovelMainPageUrl(html, url);
      if (novelUrl && novelUrl !== url) {
        try {
          const novelResp = await httpClient.get(novelUrl);
          html = novelResp.data as string;
          pageUrl = novelUrl;
        } catch {}
      }
    }

    const { coverUrl, author, synopsis } = extractNovelMeta(
      html,
      pageUrl,
      site,
    );

    let firstChapterUrl: string | null = null;
    if (!site.isChapterPage) {
      if (site.isFreeWebNovel) {
        const root = parse(html);
        const ul = root.querySelector("ul.ul-list5");
        if (ul) {
          const firstA = ul.querySelector("li a");
          if (firstA) {
            const href = firstA.getAttribute("href");
            if (href) firstChapterUrl = ensureAbsoluteUrl(href, url);
          }
        }
      } else {
        firstChapterUrl = getFirstChapterUrl(html, url);
      }
    } else {
      firstChapterUrl = url;
    }

    res.json({ title, author, synopsis, coverUrl, firstChapterUrl });
  } catch (e: any) {
    req.log.error({ err: e }, "Failed to fetch novel meta");
    res.status(500).json({ error: e.message || "Failed to fetch metadata" });
  }
});

router.post("/api/novel/next-chapter", async (req, res) => {
  const { url, chapterNum } = req.body as { url: string; chapterNum: number };
  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  const safeUrl = validateExternalHttpUrl(url);
  if (!safeUrl) {
    res.status(400).json({ error: "Invalid or disallowed URL" });
    return;
  }

  try {
    const response = await httpClient.get(safeUrl);
    const html = response.data as string;
    const content = extractChapterContent(html);
    const title = extractChapterTitle(html, chapterNum);
    const nextUrl = extractNextChapterUrl(html, safeUrl);
    res.json({ url: safeUrl, title, content, nextUrl });
  } catch (e: any) {
    req.log.error({ err: e }, "Failed to fetch next chapter");
    res.status(500).json({ error: e.message || "Failed to fetch chapter" });
  }
});

export default router;
