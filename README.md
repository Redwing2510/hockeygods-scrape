# HockeyGods content drafts

Every morning: pull hot + rising posts from all 32 NHL team subreddits (plus
r/hockey), have Claude pick the ones that fit the "the hockey gods did this"
angle, draft 3 tweet options for each, and email the whole digest to whoever
posts to @HockeyGods. Nothing posts itself — this only ever proposes.

## One-time setup

```bash
npm install
cp .env.example .env
```

Then fill in `.env`:

**1. Reddit** (read-only access — no bot account needed)
1. Log into Reddit, go to https://www.reddit.com/prefs/apps
2. "create app" (bottom left) → name it anything → type **script** → redirect
   uri can be `http://localhost` (unused for this) → create app
3. `REDDIT_CLIENT_ID` is the string under the app's name (looks like
   `Ab12Cd34Ef56Gh`). `REDDIT_CLIENT_SECRET` is the field labelled "secret".
4. `REDDIT_USER_AGENT` — anything descriptive, e.g.
   `hockeygods-content-bot/0.1 by u/yourname`.

Reddit's unauthenticated `.json` endpoints return 403 for non-browser clients
as of late 2025 — this is why the script needs a real (free) app instead of
just hitting the public feeds.

**2. Drafting model**
1. https://console.anthropic.com → API keys → create one → `ANTHROPIC_API_KEY`.
   Usage is billed per token; drafting ~33 subreddits once a day is a small
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
                      # also writes out-digest.html to preview in a browser
npm run digest        # the real thing — emails the digest
```

Run `digest:dry` first. It exercises the whole pipeline (Reddit + Claude)
without needing Gmail set up yet, and without risking an email going out
before you've seen what it produces.

## Running it every morning

macOS's own scheduler (`launchd`) is the simplest way to do this without
paying for hosting, since it just needs to run once a day on a machine that's
usually on anyway.

```bash
cp launchd/com.hockeygods.content-digest.plist ~/Library/LaunchAgents/
# edit the copied file: fix the two /ABSOLUTE/PATH/TO placeholders
launchctl load ~/Library/LaunchAgents/com.hockeygods.content-digest.plist
```

It's set to run at 7:00am local time; change the `Hour`/`Minute` in the plist
to taste. Logs land in `digest.log` / `digest.err` next to the project.

To stop it: `launchctl unload ~/Library/LaunchAgents/com.hockeygods.content-digest.plist`.

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
occasionally; if one 404s, that team's `[TEAM] skipped — ...` line in the logs
will say so and the rest of the run is unaffected.
