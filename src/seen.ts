/**
 * Tracks which Reddit posts have already been shown to Claude, so a story
 * that stays in "hot" for days doesn't get pitched to Drew fresh every
 * morning — but a trade/injury thread whose *comments* keep evolving (day 1
 * excitement, day 3 buyer's remorse) can still resurface, because what
 * matters isn't the post, it's whether there's anything new to react to.
 *
 * The signal for "anything new": comment count growth since the last time it
 * was shown. A thread that's merely still accumulating comments at its normal
 * pace stays suppressed; one that surges — GROWTH_FACTOR or more since last
 * shown — is treated as having genuinely moved and gets shown again, with
 * whatever fresh top comments it has now attached. Each resurfacing resets
 * the bar to *that* count, so a story can re-trigger more than once as it
 * develops (break -> backlash -> reversal), not just a single time.
 *
 * Without a comment count (the free RSS fallback has none), there's no growth
 * signal to check — those posts fall back to simple "already seen, stay
 * suppressed" for PRUNE_DAYS.
 *
 * State lives in a local JSON file. Fine for a Mac running this via launchd
 * (same disk every morning); silently stops working if this ever moves to
 * something with an ephemeral filesystem, like a GitHub Actions runner — a
 * fresh VM every run means an empty seen-file every run, i.e. no dedup at
 * all. Moving there means committing this file back to the repo after each
 * run, or swapping in a tiny external store.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = new URL("../data/seen.json", import.meta.url);
const GROWTH_FACTOR = 1.5; // needs 50%+ more comments than last sighting to resurface
const PRUNE_DAYS = 30; // stop tracking a thread entirely once it's this stale

interface SeenEntry {
  date: string; // last time it was shown, for pruning
  numComments: number; // its count *as of* that showing
}
type SeenMap = Record<string, SeenEntry>;

export async function loadSeen(): Promise<SeenMap> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {}; // first run, or file doesn't exist yet
  }
}

/** True if this post should be held back from today's candidates. */
export function isSuppressed(seen: SeenMap, id: string, currentComments?: number): boolean {
  const entry = seen[id];
  if (!entry) return false;
  if (currentComments == null) return true; // no growth signal (RSS path) — presence alone suppresses
  return currentComments < entry.numComments * GROWTH_FACTOR;
}

/** Records this run's shown posts (with their comment counts) and drops stale entries. */
export async function recordAndPrune(
  seen: SeenMap,
  shown: { id: string; numComments?: number }[],
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const next: SeenMap = {};
  for (const [id, entry] of Object.entries(seen)) {
    if (entry.date >= cutoffStr) next[id] = entry;
  }
  for (const s of shown) {
    next[s.id] = { date: today, numComments: s.numComments ?? next[s.id]?.numComments ?? 0 };
  }

  await mkdir(dirname(fileURLToPath(FILE)), { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 1));
}
