/**
 * Client for the paid reseller at redditapis.com — confirmed working by hand
 * against a real account:
 *   GET /api/reddit/posts?subreddit=X&sort=hot&limit=N   -> posts w/ real
 *     upvotes, comment counts, and `link_url` (the external article, cleanly
 *     separated from the reddit thread link — RSS never gave us this).
 *   GET /api/reddit/post/{id}/comments                    -> the raw Reddit
 *     comment tree (kind/data nesting); only the top-level `data.{author,
 *     score,body}` fields are used here.
 *
 * This is an independent third party, not Reddit's own API — see the caution
 * in README.md about their write endpoints before using anything beyond
 * these two read calls.
 */

import type { Candidate } from "./types.js";

const BASE = "https://api.redditapis.com";

function token(): string {
  const t = process.env.REDDITAPIS_TOKEN;
  if (!t) throw new Error("Missing REDDITAPIS_TOKEN — copy .env.example to .env and fill it in.");
  return t;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    throw new Error(`redditapis ${path} -> HTTP ${res.status} — ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface ApiPost {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  link_url: string | null;
  upvotes: number;
  comments: number;
  created: string;
  stickied?: boolean;
}

export async function fetchHotPosts(subreddit: string, limit = 15): Promise<Candidate[]> {
  const data = await get<{ posts: ApiPost[] }>(
    `/api/reddit/posts?subreddit=${subreddit}&sort=hot&limit=${limit}`,
  );
  // Pinned isn't filtered out here — a mod team pins BOTH permanent
  // housekeeping (rules, daily discussion) AND the trade/news megathread
  // they made specifically because it's the story, often the single
  // highest-engagement thread that day. Telling those apart needs the title
  // and content, so `stickied` is passed through for the drafting prompt to
  // judge rather than discarded blind.
  return (data.posts ?? []).map((p) => ({
    id: p.id,
    subreddit: p.subreddit,
    title: p.title,
    permalink: p.url,
    externalUrl: p.link_url ?? undefined,
    publishedAt: p.created,
    upvotes: p.upvotes ?? 0,
    numComments: p.comments ?? 0,
    stickied: p.stickied,
  }));
}

interface ApiCommentNode {
  data?: { author?: string; score?: number; body?: string };
}

/** Top-scoring, non-deleted top-level comments for one post. */
export async function fetchTopComments(
  postId: string,
  limit = 6,
): Promise<{ author: string; score: number; body: string }[]> {
  const data = await get<{ comments: ApiCommentNode[] }>(`/api/reddit/post/${postId}/comments`);
  return (data.comments ?? [])
    .map((c) => c.data)
    .filter(
      (d): d is { author: string; score: number; body: string } =>
        !!d && typeof d.body === "string" && d.body !== "[deleted]" && d.body !== "[removed]",
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

/**
 * Posts for one subreddit, with comments attached to the top `commentedPosts`
 * of them by engagement (upvotes + comment count) — not all of them, to keep
 * both the per-call cost and the drafting prompt's size proportional to what's
 * actually likely to matter.
 */
export async function fetchWithComments(
  subreddit: string,
  postLimit = 15,
  commentedPosts = 5,
): Promise<Candidate[]> {
  const posts = await fetchHotPosts(subreddit, postLimit);
  const byEngagement = [...posts].sort(
    (a, b) => (b.upvotes ?? 0) + (b.numComments ?? 0) - ((a.upvotes ?? 0) + (a.numComments ?? 0)),
  );
  const toEnrich = new Set(byEngagement.slice(0, commentedPosts).map((p) => p.id));

  return Promise.all(
    posts.map(async (p) => {
      if (!toEnrich.has(p.id) || p.numComments === 0) return p;
      try {
        const topComments = await fetchTopComments(p.id);
        return { ...p, topComments };
      } catch {
        return p; // one post's comments failing shouldn't drop the post itself
      }
    }),
  );
}
