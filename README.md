# HockeyGods content drafts

Every morning: pull hot posts from all 32 NHL team subreddits (plus
r/hockey), have Claude pick the ones that fit the "the hockey gods did this"
angle, draft 3 tweet options for each, and email the whole digest to whoever
posts to @HockeyGods. Nothing posts itself — this only ever proposes.

## One-time setup

```bash
npm install
cp .env.example .env
```

Then fill in `.env`:

**1. Reddit data — pick one:**

- **`REDDITAPIS_TOKEN` (recommended).** [redditapis.com](https://www.redditapis.com)
  is an independent third party (not Reddit) reselling read access at
  $0.002/call — sign up with Google or email, no card, $0.50 free credit,
  bearer token shown right after signup. This is the only path with real
  upvote/comment counts and actual comment threads, and it has no shared
  per-minute throttle to fight — a full 33-subreddit run with comments takes
  well under a minute of fetch time instead of half an hour, and realistically
  costs **$2–30/month** depending how many posts get a comments pass (see
  `commentedPosts` in `src/redditapis.ts` — currently top 5 by engagement per
  subreddit, not all 15).

  One thing worth knowing before trusting them with more than reads: their
  *write* endpoints (posting, voting, DMing) work by submitting your actual
  Reddit username/password to get session cookies, rather than real OAuth.
  Not a concern for what this project uses (reads only), but a real signal
  about how the service is built.

- **Leave `REDDITAPIS_TOKEN` unset** and it falls back to Reddit's own public
  RSS feeds — no signup, no cost, but rate-limited to **one request per
  minute per IP** (confirmed from Reddit's own response headers) and no
  comments or engagement numbers at all. `src/reddit.ts` paces itself against
  that automatically; a full 33-subreddit run this way takes ~30-35 minutes.

Reddit's own official Data API is a third option — cheaper still ($0.24/1000
calls) and not run by a third party, but as of the August 2026 policy change
it requires Reddit's manual approval, which isn't fast and isn't guaranteed.
Worth having an application in flight regardless (non-commercial or
commercial framing is your call to make, not a technical one) — if it comes
through, swapping it in only touches `src/reddit.ts`/`src/redditapis.ts`,
nothing else in the pipeline cares where posts came from.

**2. Drafting model**
1. https://console.anthropic.com → API keys → create one → `ANTHROPIC_API_KEY`.
   Usage is billed per token; drafting for ~33 subreddits once a day is a small
   daily cost — worth checking the dashboard after the first week.

**3. Email**
1. Turn on 2-Step Verification on the sending Gmail account if it isn't already
   (myaccount.google.com/security).
2. Create an app password: myaccount.google.com/apppasswords → `GMAIL_USER` /
   `GMAIL_APP_PASSWORD`.
3. `DIGEST_TO` — the inbox that should receive the daily digest.

## Running it

```bash
npm run digest:dry   # fetches + drafts for real, prints instead of emailing,
                      # also writes out-digest.html to preview
npm run digest        # the real thing — emails the digest
```

Run `digest:dry` first. It exercises the whole pipeline without needing Gmail
set up yet, and without risking an email going out before you've seen what it
produces. Progress prints per-subreddit as it goes. With `REDDITAPIS_TOKEN`
set the whole run finishes in well under a minute of fetch time; on the free
RSS fallback, expect ~30-35 minutes.

## Running it every day — GitHub Actions

`.github/workflows/digest.yml` runs this on GitHub's own infrastructure at
noon Eastern, every day, with no dependency on any machine being on. At this
project's volume (redditapis.com's throughput, one drafting call per team)
it's comfortably inside GitHub's free minutes for a private repo, and secrets
never appear in logs or in the (public) code.

One-time setup, in the repo's GitHub page: **Settings → Secrets and variables
→ Actions → New repository secret**, one for each of:

- `REDDITAPIS_TOKEN`
- `ANTHROPIC_API_KEY`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `DIGEST_TO`

— same values as `.env`. Nothing else to configure; the workflow reads those
in and runs `npm run digest` exactly like running it locally.

**Why the workflow looks more complex than one cron line:** GitHub Actions'
`schedule:` trigger is UTC-only and doesn't shift for US daylight saving —
there's no cron expression that's always "noon Eastern" year-round. Fix: it's
scheduled at both UTC times noon Eastern can be (16:00 UTC for EDT, 17:00 UTC
for EST), and the first step checks the real current Eastern hour and skips
the run if it isn't actually noon — so exactly one of the two firings does
anything on any given day, automatically correct across the DST transitions.

**Why it commits a file back to the repo:** GitHub's runners are a fresh VM
every time, so `data/seen.json` (the dedup memory from `src/seen.ts`) would
reset to empty on every run without this — meaning no repeat-suppression at
all. The workflow's last step commits the updated file back after a real run,
which is also why `data/` isn't gitignored here, unlike a typical project.

**To test without waiting for noon:** the repo's Actions tab → "Daily digest"
→ "Run workflow" triggers it immediately, real send included.

**If this ever needs to run locally instead** (a Mac that's reliably on,
say): `launchd/com.hockeygods.scrape-digest.plist` still exists for that — see
the git history for the `launchctl load` steps. Don't run both at once, or
Drew gets two emails a day.

## How the filtering works

`src/voice.ts` carries the brand-voice guide and the drafting instructions
that get sent to Claude alongside each subreddit's top posts. It's told to be
selective — routine trades, injury updates, and lineup notes should mostly be
skipped rather than force-fit into "the gods did this." Expect most days to
surface a double-digit number of candidates, not all 33 subs.

If the voice starts drifting, or you want it pickier/looser, edit
`VOICE_GUIDE` / `DRAFTING_INSTRUCTIONS` in `src/voice.ts` — nothing else needs
to change.

## Adjusting the subreddit list

`src/subreddits.ts` is one line per team. Reddit renames/merges subs
occasionally; if one 404s, that team's line in the fetch log will say so and
the rest of the run is unaffected.
