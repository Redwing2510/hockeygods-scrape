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

**1. Reddit — nothing to sign up for.** This reads Reddit's public RSS feeds,
which need no account, no app registration, no API key. `REDDIT_USER_AGENT`
is just a descriptive header, not a credential — anything identifiable works.

The tradeoff: those feeds are rate-limited to about **one request per minute
per IP** (confirmed from Reddit's own response headers — this is deliberate,
not a bug). `src/reddit.ts` paces itself against that automatically, which
means a full run across 33 subreddits takes **~30-35 minutes**. That's fine
for something that runs once before anyone's checking email — see the
scheduling note below — but it's why this can't be a fast, on-demand script.

(Reddit's official OAuth API is faster and does exist, but as of late 2025 the
app-registration/review process was enough friction that it wasn't worth it
for something this small. If that ever gets easier, swapping `src/reddit.ts`
for the OAuth version is a contained change — nothing else in the pipeline
cares where the posts came from.)

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
npm run digest:dry   # fetches + drafts for real (~30-35 min), prints instead
                      # of emailing, also writes out-digest.html to preview
npm run digest        # the real thing — emails the digest
```

Run `digest:dry` first. It exercises the whole pipeline (Reddit + Claude)
without needing Gmail set up yet, and without risking an email going out
before you've seen what it produces. Progress prints per-subreddit as it goes,
so you can watch it work through the ~35-minute Reddit pass.

## Running it every morning

macOS's own scheduler (`launchd`) is the simplest way to do this without
paying for hosting, since it just needs to run once a day on a machine that's
usually on anyway. Given the ~35-minute Reddit pass, it's scheduled well before
a normal morning-check time.

```bash
cp launchd/com.hockeygods.scrape-digest.plist ~/Library/LaunchAgents/
# edit the copied file: fix the two /ABSOLUTE/PATH/TO placeholders
launchctl load ~/Library/LaunchAgents/com.hockeygods.scrape-digest.plist
```

It's set to run at 6:15am local time (so it's done well before 7); change the
`Hour`/`Minute` in the plist to taste. Logs land in `digest.log` / `digest.err`
next to the project.

To stop it: `launchctl unload ~/Library/LaunchAgents/com.hockeygods.scrape-digest.plist`.

If this ends up running somewhere other than a Mac that's regularly on (a
server, a scheduled cloud job), swap `launchd` for a plain cron entry or a
GitHub Actions scheduled workflow — `src/index.ts` doesn't care what invokes it.

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
