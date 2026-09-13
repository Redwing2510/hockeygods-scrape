/**
 * No-signup fallback data source, used only when REDDITAPIS_TOKEN isn't set.
 * Reddit's own OAuth API requires app registration (approval-gated as of the
 * 2026 policy change); its RSS feeds still work with zero signup — confirmed
 * by hand: `curl .../hot.rss` -> 200 with real entries, no auth.
 *
 * The tradeoff is a hard rate limit: Reddit's response headers show exactly
 * one request per ~60 seconds per IP (`x-ratelimit-remaining: 0`, `reset: 55`
 * after a single call). fetchHot() below paces itself against that, reading
 * the real reset time off each response rather than guessing — so a 33-
 * subreddit run takes about half an hour this way.
 *
 * No score, comment count, or comment text is available via RSS — "hot"
 * ordering already bakes in Reddit's own vote+recency ranking, so the feed's
 * order stands in as the relevance signal. src/redditapis.ts is the primary
 * path now (real engagement numbers, real comments, no per-minute pacing);
 * this stays as the free option when no paid key is configured.
 */

import type { Candidate } from "./types.js";

const UA = process.env.REDDIT_USER_AGENT || "hockeygods-scrape/0.1 (+contact via account owner)";
const MIN_GAP_MS = 61_000; // Reddit's own window is ~60s; pad it by a second.

let earliestNextRequest = 0;

async function paced(url: string): Promise<Response> {
  const wait = earliestNextRequest - Date.now();
  if (wait > 0) await sleep(wait);

  const res = await fetch(url, { headers: { "User-Agent": UA } });

  const resetSec = Number(res.headers.get("x-ratelimit-reset"));
  earliestNextRequest = Date.now() + (Number.isFinite(resetSec) ? resetSec * 1000 : MIN_GAP_MS);

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) ? retryAfter * 1000 : MIN_GAP_MS;
    await sleep(backoff + 1000);
    return paced(url); // one retry with the server's own timing; RSS is cheap to redo
  }
  return res;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hot posts from one subreddit — the only listing fetched, to keep the daily
 *  run to one pass rather than one pass per sort order. */
export async function fetchHot(subreddit: string, limit = 15): Promise<Candidate[]> {
  const res = await paced(`https://www.reddit.com/r/${subreddit}/hot.rss?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`r/${subreddit} -> HTTP ${res.status}`);
  }
  return parseFeed(await res.text(), subreddit);
}

function parseFeed(xml: string, subreddit: string): Candidate[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries
    .map((entry) => {
      const id = tag(entry, "id")?.replace(/^t3_/, "") ?? "";
      const title = decode(tag(entry, "title") ?? "");
      const permalink = attr(entry, "link", "href") ?? "";
      const published = tag(entry, "published") ?? "";
      // <content> is HTML-escaped text containing more HTML (`&lt;a href=...`),
      // so it needs one decode() pass just to see the tags, and a URL found
      // inside is entity-encoded *again* on top of that (a literal "&" comes
      // through as "&amp;amp;") — hence decoding the extracted href a second time.
      const rawLinkHref = decode(tag(entry, "content") ?? "").match(/href="([^"]+)">\[link\]/)?.[1];
      const externalUrl = rawLinkHref && decode(rawLinkHref);
      // Self-posts' [link] just points back at the thread — not "external".
      return {
        id,
        subreddit,
        title,
        permalink,
        externalUrl: externalUrl && externalUrl !== permalink ? externalUrl : undefined,
        publishedAt: published,
      };
    })
    .filter((p) => p.id && p.title);
}

function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
}
function attr(xml: string, name: string, attrName: string): string | undefined {
  return xml.match(new RegExp(`<${name}[^>]*\\s${attrName}="([^"]*)"`))?.[1];
}
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#32;/g, " ");
}
