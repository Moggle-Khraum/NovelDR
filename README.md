----
# Novel DR

## 📑 Table of Contents

- [📖 About](#about)
- [📈 Download Counts](#download-counts)
- [🖼️ App Screenshots](#app-screenshots)
- [🌐 Supported Sources](#supported-sources)
- [📚 Wiki: Adding a Custom Source](#wiki-adding-a-custom-source)
  - [Where new sources actually live](#where-new-sources-actually-live)
  - [How site detection works](#how-site-detection-works)
  - [What you need before writing anything](#what-you-need-before-writing-anything)
  - [Getting Claude Code to do the regex-patching](#getting-claude-code-to-do-the-regex-patching)
  - [Files and fields checklist](#files-and-fields-checklist)
  - [What's next: registering the source](#whats-next-registering-the-source)
- [🌟 Appreciation](#appreciation)
- [📜 License](#license)
- [⚠️ Disclaimer](#disclaimer)

<a id="about"></a>
## 📖 About

NovelDR is a free, open-source Android application that lets you download webnovels from multiple sources and read them offline. Built for readers who want uninterrupted access to their favorite stories without ads, or account creation, only use internet when downloading.

<a id="download-counts"></a>
## 📈 Download Counts

<div align="center">

**Total Download Counts: 830+**

[![Github Downloads](https://img.shields.io/github/downloads/Moggle-Khraum/NovelDR-site/total?style=for-the-badge&logo=github&logoColor=white&color=1565C0&label=Downloads)](https://github.com/Moggle-Khraum/NovelDR-site/releases) [![MediaFire Downloads](https://img.shields.io/badge/Downloads-355-F05023?style=for-the-badge&logo=mediafire&logoColor=white)](https://www.mediafire.com/folder/hcecxy0e22g7c/apk)

**Download webnovels. Read anywhere. No ads, no login, just pure offline reading.**

🌐 [Website](https://moggle.is-a-good.dev/) · 📦 [Download APK](https://github.com/Moggle-Khraum/noveldr-site/releases) · ☕ [Leave a Tip](https://wise.com/pay/me/davea261)

</div>

<a id="app-screenshots"></a>
## 🖼️ App Screenshots

<div align="center">

| Library | Download | Updates | Settings |
| ----------- | ------------ | ----------- | ------------- |
| <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Library.jpg?raw=true" width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Download.jpg?raw=true" width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Updates.jpg?raw=true" width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Settings.jpg?raw=true" width="200"> |

| Novel Index | Novel Export| Reader | Reader Settings |
|-------------|-------------|--------|-----------------|
| <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Novel%20Index.jpg?raw=true" width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Novel%20Export.jpg?raw=true" width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Reader.jpg?raw=true"  width="200"> | <img src="https://github.com/Moggle-Khraum/resources_for_display/blob/main/screenshots/Reader%20Settings.jpg?raw=true"  width="200">                 |

</div>

##

<a id="supported-sources"></a>
## 🌐 Supported Sources

| Source | Domain | Status | Source | Domain | Status |
|--------|--------|--------|-------|--------|--------|
| ReadNovelFull | https://readnovelfull.com/ | ✅ Full support     | NovelFull.com | https://novelfull.com/ | ✅ Full support |
| NovelFull.net | https://novelfull.net/ | ✅ Full support      | AllNovel | https://allnovel.org/ | ✅ Full support |
| FreeWebNovel | https://freewebnovel.com/ | ✅ Full support   | NovGo | https://novgo.net/ | ✅ Full support |
| LightNovelWorld | https://lightnovelworld.org/ | ✅ Full support     | WuxiaWorld.site | https://wuxiaworld.site/ | ✅ Full support |
| RoyalRoad | https://www.royalroad.com/ | ✅ Full support     | AsiaNovel | https://www.asianovel.net/  | ✅ Full support  |
| NovelPheoenix | https://novelphoenix.com/ | ✅ Full Support |   |    | ✅ |
|  |  | ✅  |       |  | ✅  |
|  |  | ✅  |    |    | ✅  |

<a id="wiki-adding-a-custom-source"></a>
## 📚 Wiki: Adding a Custom Source

NovelDR's scraping is entirely client-side and regex-based — no headless browser, no backend. Built-in sites live in `hooks/useDirectScraper.ts`; everything else is added as a small, self-contained plugin under `hooks/scrapers/`. This section covers how that folder is structured, what a source needs, and how to get Claude Code to write the regex for you instead of doing it by hand.

<a id="where-new-sources-actually-live"></a>
### Where new sources actually live

```
hooks/
├── useDirectScraper.ts        ← built-in sites (FreeWebNovel, LightNovelWorld, RoyalRoad, etc.)
├── useApi.ts                  ← checks the registry first, falls back to useDirectScraper.ts
└── scrapers/
    ├── types.ts                ← the SourceScraper contract every source implements
    ├── registry.ts              ← the list of registered sources — order matters
    ├── shared/
    │   ├── html.ts               ← stripTags, decodeEntities, safeMatch, makeAbsoluteUrl, extractByDepth
    │   └── http.ts                ← fetchHtmlWithFallback (direct fetch, falls back to a CORS proxy)
    └── sources/
        ├── exampleScraper.ts      ← template — copy this for every new source
        └── novelphoenix.ts        ← a real, working reference implementation
```

**Add new sources in `hooks/scrapers/sources/`.** Each source is its own file implementing the `SourceScraper` interface from `types.ts`. `useApi.ts` decides which one handles a given URL:

```ts
// useApi.ts
export const fetchNovelMeta = async (url) => {
  const external = findExternalScraper(url);       // checks hooks/scrapers/registry.ts
  if (external) return external.fetchNovelMeta(url);
  return directFetchNovelMeta(url);                  // built-in sites
};
```

The registry is checked first; a URL only reaches `useDirectScraper.ts` if nothing registered in `hooks/scrapers/` claims it.

<a id="how-site-detection-works"></a>
### How site detection works

Every source in `hooks/scrapers/sources/` implements the same shape (`types.ts`):

```ts
export interface SourceScraper {
  id: string;                                            // e.g. "novelphoenix"
  name: string;                                           // e.g. "NovelPhoenix"
  canHandle: (url: string) => boolean;                    // does this source own this URL?
  fetchNovelMeta: (url: string) => Promise<NovelMeta>;
  fetchChapter: (url: string, chapterNum: number) => Promise<ChapterData>;
}
```

`canHandle` is usually just a hostname check:

```ts
canHandle: (url: string) => {
  try {
    return new URL(url).hostname.includes('mynovelsite.com');
  } catch {
    return false;
  }
},
```

`registry.ts` walks `REGISTERED_SCRAPERS` in array order and uses the **first** `canHandle()` that returns true — so if a hostname pattern could overlap another entry, put the more specific one first.

`NovelMeta` and `ChapterData` are the same shapes used throughout the app, so nothing downstream needs to know or care which source produced the data:

```ts
NovelMeta:    { title, author, synopsis, coverUrl, firstChapterUrl, debugInfo? }
ChapterData:  { url, title, content, nextUrl, scraperInfo? }
```

<a id="what-you-need-before-writing-anything"></a>
### What you need before writing anything

1. **Two saved HTML sources** — the novel's **info/landing page** and **one chapter page**. "View Page Source" isn't reliable enough to build a scraper against: some sites serve a different (stripped-down, bot-walled, or stale-cached) response to a raw source request than what actually renders, so you can end up writing regex against markup the live page never really shows the app.

   **More reliable: open DevTools → Elements/Inspector, let the page fully load, right-click the `<html>` root → "Copy outerHTML"**, then paste that into a `.html` (or `.txt`) file. This captures the actual final DOM after the page has settled, which is much closer to what you'll be matching against in practice.

2. **A read of the site's URL patterns** — is it `/chapter-12`, `/ch12`, `/chapter/12`, something with a numeric post ID? Matters for the meta scraper's `firstChapterUrl` construction and for direct-skip support later.

3. Confirm it isn't secretly a mirror of a site you already support before writing a whole new source for it.

<a id="getting-claude-code-to-do-the-regex-patching"></a>
### Getting Claude Code to do the regex-patching

Claude Code works well for this because it's a mechanical, pattern-matching task once it has the actual HTML in front of it — the failure mode is always giving it a description of the page instead of the page itself.

A prompt that works reliably:

> Copy `hooks/scrapers/sources/exampleScraper.ts` to `hooks/scrapers/sources/mynovelsite.ts` and implement it for `mynovelsite.com`. Here's the outerHTML for the novel info page: [paste or attach]. Here's the outerHTML for a chapter page: [paste or attach]. Follow the same structure as `hooks/scrapers/sources/novelphoenix.ts` — use `fetchHtmlWithFallback` from `../shared/http` and `safeMatch`/`decodeEntities`/`stripTags`/`makeAbsoluteUrl`/`extractByDepth` from `../shared/html`. Extract title, author, synopsis, cover URL, and first-chapter URL for the meta page; title, chapter body, and next-chapter URL for the chapter page. Then register it in `hooks/scrapers/registry.ts`.

Things worth telling it explicitly, since these are easy to get subtly wrong:
- **Give it the real captured DOM, not a summary.** "It has a div with the chapter text in it" produces guessed class names that don't exist.
- **Tell it to reuse the shared helpers** (`shared/html.ts`, `shared/http.ts`) instead of writing new ones inline — that's the whole point of the shared/ folder, and it's what keeps every source consistent.
- **Ask it to filter out junk paragraphs** (ads, "read more on X.com" boilerplate, comment counts) if the site's content block isn't clean — `novelphoenix.ts`'s `extractParagraphs()` helper is a reasonable model since it only pulls `<p>` tags rather than the whole content div verbatim.
- **Have it dry-run its regex** against the pasted HTML sample before calling the change done — a regex that "looks right" but doesn't actually match the sample is the most common failure here.

<a id="files-and-fields-checklist"></a>
### Files and fields checklist

Adding a source that's fully functional in the app (not just scrapeable) touches more than one file:

| File | What to add |
|---|---|
| `hooks/scrapers/sources/mynovelsite.ts` | New file, copied from `exampleScraper.ts`, implementing `SourceScraper` |
| `hooks/scrapers/registry.ts` | Import it and add it to `REGISTERED_SCRAPERS` — position matters if hostnames could overlap |
| `app/(tabs)/add.tsx` → `SUPPORTED_SITES` | A `{ name, baseUrl }` entry — this is what makes the site show up in the site picker and the health-check list |
| `app/(tabs)/updates.tsx` / `add.tsx` → `tryDirectSkip` | Only needed if the site has a predictable numeric chapter URL (`/chapter-N`) and you want "start from chapter 500" to jump straight there instead of crawling sequentially. Skip this if the site's URLs use opaque IDs — direct-skip will silently guess wrong |

Minimum required fields per function, or the app falls back to generic/placeholder values:

- **Meta:** `title` (fallback: derived from the URL slug), `author` (fallback: `"Unknown Author"`), `synopsis` (fallback: `"No summary available."`), `firstChapterUrl` (fallback: `null` — breaks the "start reading" flow if missing)
- **Chapter:** `title`, `content`, `nextUrl` (fallback: `null` — breaks auto-advance to the next chapter if missing)

<a id="whats-next-registering-the-source"></a>
### What's next: registering the source

1. Add the source to `REGISTERED_SCRAPERS` in `hooks/scrapers/registry.ts` — this is what `useApi.ts` actually checks first.
2. Add the site to `SUPPORTED_SITES` in `add.tsx` (see table above) — a separate registration that controls what shows up in the UI's site picker and health-check list. Nothing wires these two together automatically; both need updating.
3. Update the **Supported Sources** table at the top of this README.
4. Test both a fresh add (`add.tsx`) and an update on an already-downloaded novel (`updates.tsx`) — they call the same `fetchNovelMeta`/`fetchChapter` functions but exercise different code paths (chapter-skip logic, existing-chapter detection).

<a id="appreciation"></a>
## 🌟 Appreciation
If this project helps you somehow, please dont forget to Star the Repo~!

<a id="license"></a>
## 📜 License
This project is licensed under the MIT License

<a id="disclaimer"></a>
## ⚠️ Disclaimer

NovelDR is a tool for downloading publicly available web content. Users are responsible for ensuring their downloads comply with applicable copyright laws. We encourage supporting authors by purchasing official releases when available.

---

**Made with ❤️ for the webnovel community. No tracking, no ads — #FOSS forever.**
