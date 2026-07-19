# Changelog

All notable changes to NovelDR are documented here, newest first. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/).

Since work happens across multiple long-lived branches (`Production-0`
through `Production-4`, `Stable`, `Prod-Dev`), entries note which branch
they landed on.

## [Unreleased] — Prod-Dev

### Fixed
- **Reader showing blank chapter text for previously-downloaded novels,
  across all sources.** `LibraryContext.tsx`'s orphan-file purge
  (`purgeOrphanedChapterFiles`) was running automatically on every app
  launch and deleting `chapter_N.json` files whenever a novel's recorded
  chapter count drifted from what was actually on disk — a legitimate
  drift from migrations/restores, not real orphans. Purge is now
  Settings-triggered only; the function itself is unchanged.
- **`novel-bin.ts` / `novelbincc.ts` saving empty chapter content.**
  Chapter bodies on both sites are `<br>`-separated raw text inside
  `div#chr-content`, not individual `<p>` tags. The extractor was pulling
  `<p>...</p>` matches, which only ever found the one empty leading
  `<p></p>` and returned nothing. Switched to the same `<br>`-splitting
  approach already used (correctly) for the synopsis on both sites.
  `extractChapterBody` is now exported from each scraper file and covered
  by `scripts/test-scrapers.ts` to catch this regressing again.
- `app/novel/[id].tsx` called `deleteChapters` from `useLibrary()`, but the
  function had been removed from `LibraryContext.tsx` entirely — restored.

### Added
- `scripts/test-scrapers.ts` — regression test for chapter-content
  extraction, run in CI via the `scraper-regression` job.
- `typecheck`, `format`, `format:check`, `test:scrapers` npm scripts.
- Prettier (`.prettierrc.json`) and CI formatting check.
- `.github/dependabot.yml` for weekly dependency + Actions updates.

## Production-3

### Fixed
- `novel-bin.com` / `novelbin.cc` synopsis extraction matching the wrong
  `<meta itemprop="description">` tag in `<head>` instead of the real
  `div.desc-text` content block — anchored to `class="desc-text"` instead.
- Empty chapter content traced to the fetch layer
  (`fetchHtmlWithFallback`), not the parser, for an earlier, unrelated
  issue on the same two sources.

### Added
- `sync-lockfile.yml` — regenerates `pnpm-lock.yaml` via
  `workflow_dispatch`, since there's no local CLI to run `pnpm install`.
- `add.tsx` health-check system: `getSitesNeedingCheck()`,
  `runHealthChecks()`, self-healing fallback for sites stuck on `?`.

## Production-1

### Fixed
- `useUpdateChecker` compared semver `version` instead of
  `android.versionCode`, causing permanent false "update available"
  notifications.

### Added
- Stale-skip ceilings (`MAX_STALE_SKIPS`), URL loop detection, and a
  zero-network skip system (`existingUrlIndex`) in the update pipeline.
- Orphaned data purging at startup, pre-backup, and post-checkpoint.
- Global crash logger (`hooks/useCrashLogger.ts`) with 500KB rotation,
  covering `ErrorBoundary`, `ErrorUtils`, and unhandled promise
  rejections.

## Earlier

- `LibraryContext.tsx` refactored from a monolithic
  `novel_library_v1.json` into per-novel files
  (`novels/{id}.json` + `novel_index_v1.json`), with transparent
  one-time migration.
- Committed `novel-dr.keystore` identified as a live signing-key risk in
  the public repo; deleted via GitHub web UI, `.gitignore` updated.
  **Still recoverable from git history — not yet remediated.**
- RoyalRoad and Wuxiaworld.site scrapers integrated into
  `useDirectScraper.ts` (10 sources total at the time).
