import type { DraftedStory } from "./draft.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// One flat tool call per pick, not one call returning an array — the same
// shape draft.ts settled on after nested arrays proved unreliable.
const PICK_TOOL = {
  name: "pick_story",
  description:
    "Call once for each story to include in the digest, best first. Never pick two stories about the same underlying event.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      index: { type: "integer", description: "1-based index into the story list." },
    },
    required: ["index"],
  },
};

/**
 * Trims a day's drafted stories to the few worth a person's time: drops
 * duplicate coverage of the same event (e.g. one trade report showing up in
 * five team subs) and ranks the rest. Falls back to the most-engaged stories
 * if the call fails, so a curation hiccup never blocks the digest.
 */
export async function curateStories(stories: DraftedStory[], max: number): Promise<DraftedStory[]> {
  const byEngagement = (list: DraftedStory[]) =>
    [...list].sort((a, b) => b.engagement - a.engagement).slice(0, max);

  if (stories.length === 0) return [];

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return byEngagement(stories);

  const listing = stories
    .map(
      (s, i) =>
        `${i + 1}. [${s.team}] ${s.sourceTitle} (${s.engagement} upvotes+comments)\n${s.tweets
          .map((t, n) => `     ${n + 1}) ${t.replace(/\s+/g, " ")}`)
          .join("\n")}${s.memeIdea ? `\n     visual: ${s.memeIdea}` : ""}`,
    )
    .join("\n");

  const prompt = `You are the editor for @HockeyGods, a hockey X account. Below are today's drafted story candidates from all 32 team subreddits plus r/hockey. A person will read only the digest you assemble and wants a SHORT list — pick the best ${Math.max(10, max - 5)} to ${max}, fewer if fewer are genuinely good.

What the account's owner rates highest (match this taste), in rough priority:
1. Oddball, funny or human moments any fan would want to share: something strange found or spotted at an arena, fan-culture lore and nicknames, a funny costume, a mix-up or misunderstanding, a fanbase doing something absurd or lobbying for something ridiculous.
2. Feel-good or wild-but-true hockey moments: a rookie's first goal that wins the game, a player calling his shot and scoring, a redemption streak after being booed, a classy reunion or gesture.
3. A stat with a built-in punchline (one team with more hat tricks than home games played).
4. A clip or photo that is the whole story, and a fresh, funny angle on something the whole league is talking about.
Skip, even when it's a big name: straight records, scoring-pace and stat-line news ("ties X on the all-time list", "on pace for 58 goals", points-since-date roundups), plain trade or transaction reports that every outlet already posts, routine game threads and recaps, and league-wide topics (e.g. jersey leaks) unless there's a funny angle — keep at most one of those. Straight news with a flat draft is a no.
Judge the STORY'S hook more than how polished the draft is: the drafts are rough and a person will rewrite them. A weird, funny premise with a mediocre draft beats a polished draft of a routine story.
Duplicates: when several candidates cover the same underlying event or news item, pick only the single best one (the strongest angle and draft), never more than one per event. Also avoid filling the list with the same topic (e.g. several jersey-leak stories) — keep the one or two strongest.

Call pick_story once per story, best first.

Stories:
${listing}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        tools: [PICK_TOOL],
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
    const data = (await res.json()) as {
      content: { type: string; name?: string; input?: { index?: number } }[];
    };
    const picked: DraftedStory[] = [];
    const used = new Set<number>();
    for (const c of data.content) {
      if (c.type !== "tool_use" || c.name !== "pick_story") continue;
      const idx = c.input?.index;
      if (typeof idx !== "number" || used.has(idx) || !stories[idx - 1]) continue;
      used.add(idx);
      picked.push(stories[idx - 1]);
      if (picked.length >= max) break;
    }
    if (picked.length === 0) throw new Error("no valid picks returned");
    return picked;
  } catch (err) {
    console.error(`Curation failed, falling back to most-engaged stories: ${(err as Error).message}`);
    return byEngagement(stories);
  }
}
