import { VOICE_GUIDE, DRAFTING_INSTRUCTIONS } from "./voice.js";
import type { Candidate } from "./types.js";

export interface DraftedStory {
  team: string;
  sourceTitle: string;
  sourceUrl: string;
  tweets: string[];
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/**
 * One Claude call per team's candidates. Keeping it per-team (rather than one
 * giant call for all 32) keeps each response small enough to parse reliably
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
      const engagement =
        p.upvotes != null ? ` — ${p.upvotes} upvotes, ${p.numComments} comments` : "";
      const link = p.externalUrl ? `\n   article: ${p.externalUrl}` : "";
      const comments = (p.topComments ?? [])
        .slice(0, 5)
        .map((c) => `     "${c.body.replace(/\s+/g, " ").slice(0, 200)}" (${c.score} pts)`)
        .join("\n");
      const commentsBlock = comments ? `\n   top comments:\n${comments}` : "";
      return `${i + 1}. "${p.title}" (${age}h ago, r/${p.subreddit} hot${engagement})${link}${commentsBlock}`;
    })
    .join("\n");

  const prompt = `${VOICE_GUIDE}\n\n${DRAFTING_INSTRUCTIONS}\n\nTeam: ${team}\nToday's r/${team.toLowerCase()} hot posts:\n\n${listing}\n\nRespond with ONLY a JSON array (no prose, no markdown fence), one object per story worth drafting:\n[{"sourceIndex": 1, "tweets": ["...", "...", "..."]}]\nAn empty array [] is a completely valid answer if nothing fits today.`;

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
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error for ${team}: HTTP ${res.status} — ${await res.text()}`);
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "[]";

  let parsed: { sourceIndex: number; tweets: string[] }[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    console.error(`Could not parse drafting response for ${team}:\n${text}`);
    return [];
  }

  return parsed
    .map((item) => {
      const post = posts[item.sourceIndex - 1];
      if (!post) return null;
      return {
        team,
        sourceTitle: post.title,
        sourceUrl: post.permalink,
        tweets: item.tweets,
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
