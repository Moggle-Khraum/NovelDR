----
# Novel DR

## 📖 About

NovelDR is a free, open-source Android application that lets you download webnovels from multiple sources and read them offline. Built for readers who want uninterrupted access to their favorite stories without ads, or account creation, only use internet when downloading.

## 📈 Download Counts

<div align="center">

**Total Download Counts: 830+**

[![Github Downloads](https://img.shields.io/github/downloads/Moggle-Khraum/NovelDR-site/total?style=for-the-badge&logo=github&logoColor=white&color=1565C0&label=Downloads)](https://github.com/Moggle-Khraum/NovelDR-site/releases) [![MediaFire Downloads](https://img.shields.io/badge/Downloads-355-F05023?style=for-the-badge&logo=mediafire&logoColor=white)](https://www.mediafire.com/folder/hcecxy0e22g7c/apk)

**Download webnovels. Read anywhere. No ads, no login, just pure offline reading.**

🌐 [Website](https://moggle.is-a-good.dev/) · 📦 [Download APK](https://github.com/Moggle-Khraum/noveldr-site/releases) · ☕ [Leave a Tip](https://wise.com/pay/me/davea261)

</div>

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

## 🌐 Supported Sources

| Source | Domain | Status | Source | Domain | Status |
|--------|--------|--------|-------|--------|--------|
| ReadNovelFull | https://readnovelfull.com/ | ✅ Full support     | NovelFull.com | https://novelfull.com/ | ✅ Full support |
| NovelFull.net | https://novelfull.net/ | ✅ Full support      | AllNovel | https://allnovel.org/ | ✅ Full support |
| FreeWebNovel | https://freewebnovel.com/ | ✅ Full support   | NovGo | https://novgo.net/ | ✅ Full support |
| LightNovelWorld | https://lightnovelworld.org/ | ✅ Full support     | WuxiaWorld.site | https://wuxiaworld.site/ | ✅ Full support |
| RoyalRoad | https://www.royalroad.com/ | ✅ Full support     | AsiaNovel | https://www.asianovel.net/  | ✅ Full support  |
|  |  | ✅  |   |    | ✅ |
|  |  | ✅  |       |  | ✅  |
|  |  | ✅  |    |    | ✅  |

## 📚 Wiki: Adding a Custom Source

NovelDR's scraper is entirely client-side and regex-based — no headless browser, no backend. Every site is just a block of pattern matches inside one hook file. This section walks through how those blocks are structured, what a new source needs, and how to get Claude Code to write the regex for you instead of doing it by hand.

### How site detection works

Everything lives in `hooks/useDirectScraper.ts`, in two exported functions:

- **`directFetchNovelMeta(url)`** — scrapes the novel's info/landing page. Returns a `NovelMeta`:
  ```ts
  { title, author, synopsis, coverUrl, firstChapterUrl, debugInfo? }
  ```
- **`directFetchChapter(url, chapterNum)`** — scrapes a single chapter page. Returns a `ChapterData`:
  ```ts
  { url, title, content, nextUrl, scraperInfo? }
  ```

Both functions detect which site they're looking at the same simple way:

```ts
const domainLower = url.toLowerCase();
const isMySite = domainLower.includes('mynovelsite.com');
```

Then a block like `if (isMySite) { ... }` runs regex/`safeMatch()` calls against the raw HTML to pull out each field. There's no plugin system or per-site file — you're adding an `if` block to each function, next to all the others (FreeWebNovel, LightNovelWorld, RoyalRoad, etc. are good ones to read as reference).

`nextUrl` for chapters is usually free — there's a generic fallback near the end of `directFetchChapter` that scans every `<a>` tag on the page for the word "next" in its text/class/id, and that works for most sites without any site-specific code. You only need to write custom next-chapter logic if the site doesn't have a straightforward "Next Chapter" link (AsiaNovel is the one exception currently, because its "next" links are ambiguous — see the comment above `isAsianovel` in the file).

### What you need before writing anything

1. **Two saved HTML sources**, not screenshots:
   - The novel's **info/landing page** (title, author, synopsis, cover, chapter list)
   - **One chapter page** (title, body text, next-chapter link)

   Save these as `.html` files from your browser's "View Page Source" (not "Inspect Element" — you want the raw server response, since some sites render extra stuff client-side that won't be there when the app fetches it).

2. **A read of the site's URL patterns** — is it `/chapter-12`, `/ch12`, `/chapter/12`, something with a numeric post ID? This matters for two extra things beyond the scraper itself (covered below): the direct-skip patterns and the meta scraper's `firstChapterUrl` construction.

3. Confirm it isn't secretly a mirror. BedNovel looked like a separate site but was just a redirect front for FreeWebNovel with no real content of its own — worth checking before writing a whole new block for what's actually zero new site.

### Getting Claude Code to do the regex-patching

Claude Code works well for this because it's a mechanical, pattern-matching task once it has the actual HTML in front of it — the failure mode is always giving it a description of the page instead of the page itself.

A prompt that works reliably:

> I want to add support for `mynovelsite.com` to NovelDR's scraper (`hooks/useDirectScraper.ts`). Here's the HTML for the novel info page: [paste or attach]. Here's the HTML for a chapter page: [paste or attach]. Add a new `isMynovelsite` detection block to both `directFetchNovelMeta` and `directFetchChapter`, following the same pattern as the existing FreeWebNovel block. Extract: title, author, synopsis, cover image URL, and first-chapter URL for the meta page; title and chapter body paragraphs for the chapter page. Use `safeMatch()` and `decodeEntities()`/`stripTags()` like the rest of the file does.

Things worth telling it explicitly, since these are easy to get subtly wrong:
- **Give it the real markup, not a summary.** "It has a div with the chapter text in it" produces guessed class names that don't exist.
- **Tell it to reuse existing helpers** (`safeMatch`, `decodeEntities`, `stripTags`, `makeAbsoluteUrl`) instead of writing new ones — keeps the file consistent and avoids subtly different HTML-entity/whitespace handling per site.
- **Ask it to filter out junk paragraphs** (ads, "read more on X.com" boilerplate, comment counts) the same way the FreeWebNovel block does with its `junkPhrases` array — the generic fallback catches real chapter text but also catches nav cruft if you don't filter it.
- **Have it dry-run its regex** against the pasted HTML sample before calling the change done — a regex that "looks right" but doesn't actually match the sample is the most common failure here.

### Files and fields checklist

Adding a source that's fully functional in the app (not just scrapeable) touches more than one file:

| File | What to add |
|---|---|
| `hooks/useDirectScraper.ts` | The `isMySite` detection + extraction block in **both** `directFetchNovelMeta` and `directFetchChapter` |
| `app/(tabs)/add.tsx` → `SUPPORTED_SITES` | A `{ name, baseUrl }` entry — this is what makes the site show up in the site picker and the health-check list |
| `app/(tabs)/updates.tsx` / `add.tsx` → `tryDirectSkip` | Only needed if the site has a predictable numeric chapter URL (`/chapter-N`) and you want "start from chapter 500" to jump straight there instead of crawling sequentially. Skip this if the site's URLs use opaque IDs (like AsiaNovel) — direct-skip will silently guess wrong |

Minimum required fields per function, or the app falls back to generic/placeholder values:

- **Meta:** `title` (fallback: derived from the URL slug), `author` (fallback: `"Unknown Author"`), `synopsis` (fallback: `"No summary available."`), `firstChapterUrl` (fallback: `null` — breaks the "start reading" flow if missing)
- **Chapter:** `title`, `content` (fallback: generic `<p>`-tag scrape across the whole page, which usually includes nav/ads if the site's real content div wasn't matched)

### What's next: registering the source

1. Add the site to `SUPPORTED_SITES` in `add.tsx` (see table above) — this is the "registry." Nothing reads the scraper's `if` blocks to build the site list automatically; the array is the actual source of truth for what shows up in the UI.
2. Update the **Supported Sources** table at the top of this README.
3. Test both a fresh add (`add.tsx`) and an update on an already-downloaded novel (`updates.tsx`) — they call the same scraper functions but exercise different code paths (chapter-skip logic, existing-chapter detection).
4. **Known cleanup item:** `SUPPORTED_SITES` in `add.tsx` still lists `NovelBinCom` and `BedNovelCom`, even though their scraper blocks were removed from `useDirectScraper.ts`. Selecting either in the app right now will silently fall through to the generic fallback scraper instead of failing loudly. Worth pulling both entries next time you're in that file.

## 🌟 Appreciation
If this project helps you somehow, please dont forget to Star the Repo~!

## 📜 License
This project is licensed under the MIT License

## ⚠️ Disclaimer

NovelDR is a tool for downloading publicly available web content. Users are responsible for ensuring their downloads comply with applicable copyright laws. We encourage supporting authors by purchasing official releases when available.

---

**Made with ❤️ for the webnovel community. No tracking, no ads — #FOSS forever.**
