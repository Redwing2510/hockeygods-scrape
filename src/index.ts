import { TEAM_SUBREDDITS, LEAGUE_SUBREDDIT } from "./subreddits.js";
import { fetchHot } from "./reddit.js";
import { fetchWithComments } from "./redditapis.js";
import { draftForTeam, type DraftedStory } from "./draft.js";
import { sendDigest, renderDigestHtml } from "./email.js";
import type { Candidate } from "./types.js";

const dryRun = process.argv.includes("--dry-run");
const usingPaidApi = Boolean(process.env.REDDITAPIS_TOKEN);

// redditapis.com has no shared per-minute throttle to respect (that's the
// whole point of paying for it), so fetches run concurrently; the free RSS
// fallback paces itself internally and stays sequential regardless.
const FETCH_CONCURRENCY = usingPaidApi ? 5 : 1;
const DRAFT_CONCURRENCY = 4;

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>, conc: number): Promise<R[]> {
  const out: R[] = [];
  const queue = [...items];
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const item = queue.shift() as T;
        out.push(await fn(item));
      }
    }),
  );
  return out;
}

async function fetchTeam(team: string, subreddit: string): Promise<[string, Candidate[]]> {
  try {
    const posts = usingPaidApi
      ? await fetchWithComments(subreddit)
      : await fetchHot(subreddit);
    console.log(`  [${team}] r/${subreddit} — ${posts.length} posts`);
    return [team, posts];
  } catch (err) {
    console.error(`  [${team}] r/${subreddit} — skipped: ${(err as Error).message}`);
    return [team, []];
  }
}

async function main() {
  const entries: [string, string][] = [
    ...Object.entries(TEAM_SUBREDDITS),
    ["NHL", LEAGUE_SUBREDDIT],
  ];

  console.log(
    usingPaidApi
      ? `Fetching ${entries.length} subreddits via redditapis.com (with comments)...`
      : `Fetching ${entries.length} subreddits via Reddit RSS (paced ~1/min, so this takes a while)...`,
  );
  const fetched = await pool(entries, ([team, sub]) => fetchTeam(team, sub), FETCH_CONCURRENCY);
  const byTeam = new Map(fetched.filter(([, posts]) => posts.length > 0));

  console.log(`\nDrafting for ${byTeam.size} teams with posts...`);
  const results = await pool(
    [...byTeam.entries()],
    ([team, posts]) => draftForTeam(team, posts),
    DRAFT_CONCURRENCY,
  );
  const stories = results.flat() as DraftedStory[];

  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n${stories.length} candidate stories drafted for ${date}.`);

  if (dryRun) {
    console.log("\n--- DRY RUN: would email this ---\n");
    for (const s of stories) {
      console.log(`\n[${s.team}] ${s.sourceTitle}\n  ${s.sourceUrl}`);
      s.tweets.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    }
    const fs = await import("node:fs/promises");
    await fs.writeFile("out-digest.html", renderDigestHtml(date, stories));
    console.log("\nAlso wrote out-digest.html for a preview in a browser.");
    return;
  }

  await sendDigest(date, stories);
  console.log("Digest emailed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
