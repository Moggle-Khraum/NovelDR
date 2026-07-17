# 📚 How NovelDR Gets Stories from Websites (Simplified)

## ✨ The Simple Version

NovelDR reads stories directly from novel websites — kind of like how you'd manually copy-paste a book chapter into your phone. It extracts:
- The book's title, author, and cover image
- The summary (synopsis)
- Individual chapter text
- Links to the next chapter

**It does all this automatically, without needing a middleman server.**

---

## 🧩 How Adding a New Website Works

Think of it like teaching NovelDR to read a new bookstore's layout.

### 1️⃣ Save the Website's HTML
When you want to add support for a new story website, you need to give NovelDR the "actual page code" — not a description, but the real thing the website sends.

**How to get it (the reliable way):**
1. Open the novel's main page in your browser
2. Right-click anywhere on the page → click **Inspect**
3. In the panel that opens, right-click the `<html>` tag at the top → click **Edit HTML**
4. Click inside that HTML box, then press **Ctrl+A** (select all) → **Ctrl+C** (copy)
5. Open Notepad (or any text editor) → **Ctrl+V** (paste) → save as a `.txt` file

**Then do the exact same thing for one chapter page** — right-click, Inspect, Edit HTML, Ctrl+A, Ctrl+C, paste into a second Notepad file.

You'll end up with two files:
- One for the novel's main/info page (title, author, cover, summary)
- One for a chapter page (the actual story text)

**Why Inspect + Edit HTML instead of View Source?** View Source shows the original code sent by the website, which can be different from what's actually on the page. Edit HTML shows the real, final version after everything has loaded — much more accurate to copy from.

### 2️⃣ Find the URL Pattern
Look at how the website structures its links. For example:
- Does it use `/chapter-12`, `/ch-12`, or `/chapter/12`?
- Are there numeric IDs or random slugs?

This helps NovelDR understand how to find chapters, and matters later for "jump straight to chapter 500" style shortcuts.

---

## 🤖 Telling Claude What to Build

Once you have both `.txt` files, you give them to Claude Code in two rounds:

**Round 1 — the info page:**
> Here's the pasted HTML from the novel's main page. Build a regex-based extractor for the title, author, cover image, and synopsis/summary.

**Round 2 — the chapter page:**
> Here's the pasted HTML from a chapter page. Build a regex-based extractor for the chapter content.

Claude writes the matching code for each piece, following the same format as existing sources — see `novelphoenix.ts` for a working example: it defines a `canHandle` check for the site's domain, a `fetchNovelMeta` function for the info page, and a `fetchChapter` function for the story text, all using the shared helpers (`stripTags`, `decodeEntities`, `safeMatch`, `extractByDepth`, `makeAbsoluteUrl`).

---

## 🗂️ What Gets Added to the App

Once you've built a scraper, you need to register it in **three places**:

| Where | What You Add | Why |
|-------|-------------|-----|
| **Scraper File** | A new file that knows how to read this specific website | Makes it actually work |
| **Registry** | Add it to the list of known websites | Tells the app "we support this site now" |
| **Site Picker** | Add it to the dropdown list | Users see it when adding a new book |

---

## ✅ Checklist: What Info Must Be Captured

**For the Book's Info Page:**
- ✅ Title (absolutely necessary)
- ✅ Author
- ✅ Summary/synopsis
- ✅ Cover image
- ✅ Link to first chapter (absolutely necessary)

**For Each Chapter:**
- ✅ Chapter title
- ✅ The actual story text
- ✅ Link to next chapter (needed for "auto-advance")

If any of the "absolutely necessary" ones are missing, the app won't work properly for that site.

---

## 💡 Why This Matters

By making scrapers modular (each website in its own little file), new websites can be added without breaking the existing ones. It's like having a folder for each bookstore's "how to find books here" instructions instead of one massive rulebook that has to be rewritten every time.

The shared tools (the "helpers") make sure every website scraper works the same way — so the app's reading screen doesn't care which website the book came from.
