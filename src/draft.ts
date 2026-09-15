import { VOICE_GUIDE, DRAFTING_INSTRUCTIONS } from "./voice.js";
import type { Candidate } from "./types.js";

export interface DraftedStory {
  team: string;
  sourceTitle: string;
  sourceUrl: string;
  tweets: string[];
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Forces a real, schema-shaped response instead of asking the model to write
// JSON as prose and hoping it comes out well-formed — confirmed by hand
// (structured-test.ts) this eliminates the malformed/truncated-JSON failures
// that were silently dropping whole teams (CGY, WSH, WPG on 2026-09-15; ANA,
// LAK, EDM before that). One iteration mattered: a single tool call returning
// an array-of-stories still let the model occasionally wrap that array in an
// unnecessary (and sometimes internally malformed) string — nesting was the
// problem. Calling the tool once PER STORY with flat fields instead removes
// the nesting entirely, so there's nothing left to stringify or miscount.
const DRAFT_TOOL = {
  name: "propose_draft",
  description:
    "Call this once for each story from today's candidates that fits the 'hockey gods' angle. Don't call it at all if nothing fits — zero calls is a valid response.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      sourceIndex: { type: "integer", description: "1-based index into the candidate list." },
      tweet1: { type: "string", description: "The straight/dry option." },
      tweet2: { type: "string", description: "The more pointed option." },
      tweet3: { type: "string", description: "The option that leans hardest into the 'gods' framing." },
    },
    required: ["sourceIndex", "tweet1", "tweet2", "tweet3"],
  },
};

interface RawStory {
  sourceIndex: number;
  tweet1: string;
  tweet2: string;
  tweet3: string;
}

/**
 * One Claude call per team's candidates. Keeping it per-team (rather than one
 * giant call for all 32) keeps each response small enough to stay reliable
 * and means one bad subreddit fetch doesn't sink the whole digest.
 */
export async function draftForTeam(team: string, posts: Candidate[]): Promise<DraftedStory[]> {
  if (posts.length === 0) return [];

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY — copy .env.example to .env and fill it in.");

  const listing = posts
    .slice(0, 15)
    .map((p, i) => {
      const age = hoursAgo(p.publishedAt);
      const pinned = p.stickied ? " [PINNED by mods]" : "";
      const engagement =
        p.upvotes != null ? ` — ${p.upvotes} upvotes, ${p.numComments} comments` : "";
      const link = p.externalUrl ? `\n   article: ${p.externalUrl}` : "";
      const comments = (p.topComments ?? [])
        .slice(0, 5)
        .map((c) => `     "${c.body.replace(/\s+/g, " ").slice(0, 200)}" (${c.score} pts)`)
        .join("\n");
      const commentsBlock = comments ? `\n   top comments:\n${comments}` : "";
      return `${i + 1}. "${p.title}"${pinned} (${age}h ago, r/${p.subreddit} hot${engagement})${link}${commentsBlock}`;
    })
    .join("\n");

  const prompt = `${VOICE_GUIDE}\n\n${DRAFTING_INSTRUCTIONS}\n\nTeam: ${team}\nToday's r/${team.toLowerCase()} hot posts:\n\n${listing}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // A team with several qualifying stories in one day can need more than
      // a couple thousand tokens to finish — a low cap doesn't save money
      // (billed on tokens actually used, not the ceiling), it just truncates
      // mid-response and silently drops that team's stories.
      max_tokens: 6000,
      tools: [DRAFT_TOOL],
      // "auto" (not forcing the tool) is what allows zero calls — the model
      // just doesn't invoke propose_draft on a day nothing qualifies.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error for ${team}: HTTP ${res.status} — ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: { type: string; name?: string; input?: RawStory }[];
  };
  // Zero, one, or many tool_use blocks — each one is already a plain flat
  // object (Anthropic parses the schema-shaped input for us), no JSON.parse
  // and no nesting left to go wrong.
  const calls = data.content.filter(
    (c): c is { type: "tool_use"; name: string; input: RawStory } =>
      c.type === "tool_use" && c.name === "propose_draft" && !!c.input,
  );

  return calls
    .map((call) => {
      const item = call.input;
      const post = posts[item.sourceIndex - 1];
      if (!post) return null;
      return {
        team,
        sourceTitle: post.title,
        sourceUrl: post.permalink,
        tweets: [item.tweet1, item.tweet2, item.tweet3],
      };
    })
    .filter((x): x is DraftedStory => x !== null);
}

function hoursAgo(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}
