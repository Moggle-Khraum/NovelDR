# Security Policy

NovelDR is a personal Android app for reading novels. It's not on the Play Store — you download the APK from GitHub Releases and install it yourself. It's built and maintained by one person.

Because of that, "security" here mostly means: **is the app doing what it's supposed to do, safely, without putting your device or data at risk.** It's not a banking app or a website with logins — but a few things can still go wrong, and this page explains how to report them.

## Which versions get fixes

| Version | Still supported? |
| ------- | ----------------- |
| 4.0.x and newer | Yes |
| Older than 4.0.x | No — please update first |

If you're on an old version, grab the latest one from [Repository Release](https://github.com/Moggle-Khraum/NovelDR/releases) or from [Website Release](https://github.com/Moggle-Khraum/NovelDR-site/releases) first. Your problem might already be fixed.

## What kind of problems to report here

Report it here if it's something like:

- A novel website's page content somehow makes the app do something it shouldn't (crash in a weird way, run something it shouldn't, etc.)
- Restoring a backup file causes the app to write files somewhere it shouldn't on your phone
- The app storing something sensitive on your device in an unsafe way
- A code library the app uses has a known security problem that actually affects NovelDR
- Something is off with how the APK is built or released (e.g. a release looking tampered with)

If it's just a normal bug — the app crashes, a novel source stops working, a button doesn't do the right thing — that's a regular bug report, not a security one. Just open a normal GitHub issue for those.

## How to report a real security problem

**Please don't post it as a public GitHub issue.** Posting details publicly before it's fixed means anyone can see how to exploit it.

Instead:

- Use GitHub's private "Report a vulnerability" option on this repo, if you see it under the Security tab, or
- Open a plain issue that just says "Security contact request" with no details, and a private way to talk will be set up from there.

When you report it, try to include:
- What version of the app you're using
- What happened, step by step
- What you think could go wrong because of it

## What happens after you report it

This is a one-person project, not a company, so there's no fixed guarantee — but here's what to expect:

- You'll get a reply within a few days.
- You'll get occasional updates (roughly weekly) while it's being looked into.
- If it's a real issue, it'll get fixed and you'll be credited in the changelog, unless you'd rather stay anonymous.
- If it's not something that can actually be exploited, you'll get an honest explanation of why.

## A few honest notes

- The novel websites NovelDR pulls chapters from are not controlled by this project. Problems with those sites themselves aren't something this policy covers.
- This app hasn't been professionally audited. It's one person doing their best, not an enterprise-grade security team — please keep that in mind.
