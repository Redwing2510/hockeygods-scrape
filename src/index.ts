import { TEAM_SUBREDDITS, LEAGUE_SUBREDDIT } from "./subreddits.js";
import { fetchHot, type RedditPost } from "./reddit.js";
import { draftForTeam, type DraftedStory } from "./draft.js";
import { sendDigest, renderDigestHtml } from "./email.js";

const DRAFT_CONCURRENCY = 4;
const dryRun = process.argv.includes("--dry-run");

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

/**
 * One subreddit at a time, on purpose — Reddit's RSS rate limit is a single
 * shared budget per IP (see src/reddit.ts), so fetching "concurrently" here
 * would just mean every request but the first gets a 429 and retries anyway.
 * Expect this loop alone to take ~30-35 minutes for all 33 subs.
 */
async function fetchAll(entries: [string, string][]): Promise<Map<string, RedditPost[]>> {
  const byTeam = new Map<string, RedditPost[]>();
  for (const [team, sub] of entries) {
    try {
      const posts = await fetchHot(sub);
      byTeam.set(team, posts);
      console.log(`  [${team}] r/${sub} — ${posts.length} posts`);
    } catch (err) {
      console.error(`  [${team}] r/${sub} — skipped: ${(err as Error).message}`);
    }
  }
  return byTeam;
}

async function main() {
  const entries: [string, string][] = [
    ...Object.entries(TEAM_SUBREDDITS),
    ["NHL", LEAGUE_SUBREDDIT],
  ];

  console.log(`Fetching ${entries.length} subreddits (paced ~1/min, so this takes a while)...`);
  const byTeam = await fetchAll(entries);

  console.log(`\nDrafting for ${byTeam.size} teams with posts...`);
  const results = await pool(
    [...byTeam.entries()],
    ([team, posts]) => draftForTeam(team, posts),
    DRAFT_CONCURRENCY,
  );
  const stories = results.flat();

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
