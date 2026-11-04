import { TEAM_SUBREDDITS, LEAGUE_SUBREDDIT } from "./subreddits.js";
import { fetchHot } from "./reddit.js";
import { fetchWithComments } from "./redditapis.js";
import { draftForTeam, type DraftedStory } from "./draft.js";
import { curateStories } from "./curate.js";
import { sendDigest, renderDigestHtml } from "./email.js";
import { loadSeen, isSuppressed, recordAndPrune } from "./seen.js";
import type { Candidate } from "./types.js";

const dryRun = process.argv.includes("--dry-run");
const usingPaidApi = Boolean(process.env.REDDITAPIS_TOKEN);

// redditapis.com has no shared per-minute throttle to respect (that's the
// whole point of paying for it), so fetches run concurrently; the free RSS
// fallback paces itself internally and stays sequential regardless.
const FETCH_CONCURRENCY = usingPaidApi ? 5 : 1;
const MAX_STORIES = Number(process.env.DIGEST_MAX_STORIES) || 15;
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

let failedFetches = 0;

async function fetchTeam(team: string, subreddit: string): Promise<[string, Candidate[]]> {
  try {
    const posts = usingPaidApi
      ? await fetchWithComments(subreddit)
      : await fetchHot(subreddit);
    console.log(`  [${team}] r/${subreddit} — ${posts.length} posts`);
    return [team, posts];
  } catch (err) {
    failedFetches++;
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

  // If the data source is down (not just one flaky subreddit), fail the run
  // instead of emailing an empty digest: a failed run sends nothing and leaves
  // last-sent.txt alone, so the very next daily trigger tries again.
  if (failedFetches > entries.length / 2) {
    throw new Error(
      `Reddit data source failed for ${failedFetches} of ${entries.length} subreddits — not sending an empty digest.`,
    );
  }

  // Drop anything already shown to Claude whose comment count hasn't moved
  // meaningfully since then — otherwise a story that stays "hot" for days
  // gets redrafted and re-emailed each morning. A real surge in comments
  // (sentiment flipping, national coverage catching up) un-suppresses it. See
  // src/seen.ts for the exact rule, and why this is keyed on "shown to
  // Claude", not "actually drafted".
  const seen = await loadSeen();
  const byTeam = new Map<string, Candidate[]>();
  let totalFetched = 0;
  let totalNew = 0;
  for (const [team, posts] of fetched) {
    totalFetched += posts.length;
    const fresh = posts.filter((p) => !isSuppressed(seen, p.id, p.numComments));
    totalNew += fresh.length;
    if (fresh.length > 0) byTeam.set(team, fresh);
  }
  console.log(`\n${totalFetched - totalNew} of ${totalFetched} posts already seen with nothing new — skipping those.`);

  console.log(`Drafting for ${byTeam.size} teams with new posts...`);
  const results = await pool(
    [...byTeam.entries()],
    ([team, posts]) => draftForTeam(team, posts),
    DRAFT_CONCURRENCY,
  );
  const drafted = results.flat() as DraftedStory[];

  // The reader wants a short list, not everything that qualified: merge
  // duplicate coverage of the same event and keep only the best few.
  const stories = await curateStories(drafted, MAX_STORIES);
  const cut = new Set(drafted.filter((d) => !stories.includes(d)).map((d) => d.sourceId));

  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n${drafted.length} candidate stories drafted, ${stories.length} kept for ${date}.`);

  if (dryRun) {
    console.log("\n--- DRY RUN: would email this (seen-tracking not updated) ---\n");
    for (const s of stories) {
      console.log(`\n[${s.team}] ${s.sourceTitle}\n  ${s.sourceUrl}`);
      s.tweets.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
      if (s.memeIdea) console.log(`  Meme idea: ${s.memeIdea}`);
    }
    const fs = await import("node:fs/promises");
    await fs.writeFile("out-digest.html", renderDigestHtml(date, stories));
    console.log("\nAlso wrote out-digest.html for a preview in a browser.");
    return;
  }

  await sendDigest(date, stories);
  console.log("Digest emailed.");

  // Every post shown to Claude this run counts as "seen" going forward, drafted
  // or not, recorded with today's comment count as the new baseline to grow
  // past — mark them only now, after a successful send. The exception is a
  // story that was drafted but cut by the cap: it stays eligible next run.
  const shown = [...byTeam.values()]
    .flatMap((posts) => posts.map((p) => ({ id: p.id, numComments: p.numComments })))
    .filter((p) => !cut.has(p.id));
  await recordAndPrune(seen, shown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
