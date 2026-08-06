# Contributing to NovelDR

NovelDR is a personal novel-reading app for Android, built with React Native / Expo. It started as a solo project, but if you'd like to add a source, fix something, or clean up parts of the codebase, this doc covers how it's organized and what to know before diving in.

## Before you start

- This is a hobby project, not a company product — response times on PRs/issues may vary.
- Please open an issue first for anything bigger than a small fix (new features, big refactors) so we're on the same page before you spend time on it.
- Small fixes, typo corrections, or new scraper sources can just go straight to a pull request.

## Getting set up

```bash
git clone https://github.com/Moggle-Khraum/NovelDR.git
cd NovelDR
pnpm install
```

The app lives under `artifacts/novel-reader/`. It's built with Expo (managed workflow) and EAS for builds — you don't need a Mac or physical device to contribute code, just Node + pnpm.

## Where things live (roughly)

```
artifacts/novel-reader/
├── app/                  # screens (Expo Router)
├── context/              # app-wide state (library, settings, etc.)
├── hooks/scrapers/       # everything related to pulling novels from sites
│   ├── types.ts          # the shared shape every scraper follows
│   ├── registry.ts       # where new sources get registered
│   ├── shared/           # shared HTML/HTTP helpers used by all scrapers
│   └── sources/          # one file per novel site
├── lib/                  # standalone utilities (TTS, backups, etc.)
```

If you're not sure where something belongs, it's fine to ask in your PR description — better than guessing and having to redo it.

## Adding a new novel source

This is the easiest and most welcome kind of contribution — full step-by-step instructions (including how to grab a site's HTML, common gotchas, and a checklist of what's required) are in **[`NovelDR Scraper Guide.md`](./NovelDR%20Scraper%20Guide.md)**. Please follow that guide rather than winging it — it covers real issues past scrapers have hit (bare `<br>` paragraphs, `safeMatch` quirks, disabled "next chapter" links, etc.) that are easy to miss otherwise.

The short version: each source is one file in `hooks/scrapers/sources/`, built off the `exampleScraper.ts` template, using the shared helpers in `hooks/scrapers/shared/`, and registered in `hooks/scrapers/registry.ts`.

## Fixing bugs / improving the codebase

- Try to keep changes scoped to the problem you're fixing — avoid drive-by rewrites of unrelated code in the same PR, it makes review harder.
- If you're touching a screen or context file (`index.tsx`, `LibraryContext.tsx`, `settings.tsx`, etc.), be aware these are large, actively-changing files — a quick check with an open issue or a comment on your PR about what you're changing helps avoid conflicting work.
- Match the existing code style. There's ESLint + TypeScript checks in CI — please make sure `pnpm lint` and `pnpm typecheck` pass before opening a PR.

## Commit / PR style

- Keep commits reasonably scoped — one logical change per commit is easier to review than one giant commit.
- In your PR description, briefly explain **what** changed and **why** — screenshots or a short screen recording help a lot for UI changes.
- Reference the related issue number if there is one.

## Reporting bugs (not security issues)

Regular bugs — crashes, a source breaking, UI glitches — go in [GitHub Issues](https://github.com/Moggle-Khraum/NovelDR/issues). Include your app version and steps to reproduce if you can.

For anything that looks like a genuine security problem instead of a normal bug, please see [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree your changes are licensed under the same license as the rest of the project (see [LICENSE](./LICENSE)).
