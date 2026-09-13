import { TEAM_SUBREDDITS, LEAGUE_SUBREDDIT } from "./subreddits.js";
import { fetchCandidatePosts } from "./reddit.js";
import { draftForTeam, type DraftedStory } from "./draft.js";
import { sendDigest, renderDigestHtml } from "./email.js";

const CONCURRENCY = 4;
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

async function processTeam(team: string, subreddit: string): Promise<DraftedStory[]> {
  try {
    const posts = await fetchCandidatePosts(subreddit);
    return await draftForTeam(team, posts);
  } catch (err) {
    console.error(`[${team}] skipped — ${(err as Error).message}`);
    return [];
  }
}

async function main() {
  const entries = [
    ...Object.entries(TEAM_SUBREDDITS),
    ["NHL", LEAGUE_SUBREDDIT] as [string, string],
  ];

  console.log(`Fetching + drafting across ${entries.length} subreddits...`);
  const results = await pool(entries, ([team, sub]) => processTeam(team, sub), CONCURRENCY);
  const stories = results.flat();

  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n${stories.length} candidate stories drafted for ${date}.`);

  if (dryRun) {
    console.log("\n--- DRY RUN: would email this ---\n");
    for (const s of stories) {
      console.log(`\n[${s.team}] ${s.sourceTitle}\n  ${s.sourceUrl}`);
      s.tweets.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    }
    // also write the rendered HTML next to the script for a quick visual check
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
