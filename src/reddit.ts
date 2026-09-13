/**
 * Read-only Reddit access via app-only OAuth (the "client_credentials" grant).
 * This works for public subreddits with just a client id/secret — no bot
 * account, no username/password, no elevated scopes. Reddit's unauthenticated
 * `.json` endpoints now return 403 for non-browser clients, so this is the only
 * reliable path (confirmed by hand: `curl .../hot.json` -> 403 as of Sept 2026).
 *
 * Create the app at https://www.reddit.com/prefs/apps -> "create app" -> type
 * "script". The client id is the string under the app name; the secret is
 * labelled "secret".
 */

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  score: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  isSelf: boolean;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const id = requireEnv("REDDIT_CLIENT_ID");
  const secret = requireEnv("REDDIT_CLIENT_SECRET");
  const ua = process.env.REDDIT_USER_AGENT || "hockeygods-scrape-bot/0.1";

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Reddit auth failed: HTTP ${res.status} — ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy .env.example to .env and fill it in.`);
  return v;
}

/**
 * Hot and rising posts from one subreddit, merged and de-duplicated. Rising
 * catches something breaking in the last hour or two that hot hasn't caught up
 * to yet — the "as it's happening" half of the ask.
 */
export async function fetchCandidatePosts(subreddit: string, limit = 15): Promise<RedditPost[]> {
  const token = await getToken();
  const ua = process.env.REDDIT_USER_AGENT || "hockeygods-scrape-bot/0.1";
  const headers = { Authorization: `Bearer ${token}`, "User-Agent": ua };

  const [hot, rising] = await Promise.all([
    fetchListing(`https://oauth.reddit.com/r/${subreddit}/hot`, limit, headers),
    fetchListing(`https://oauth.reddit.com/r/${subreddit}/rising`, Math.ceil(limit / 2), headers),
  ]);

  const seen = new Set<string>();
  const merged: RedditPost[] = [];
  for (const p of [...rising, ...hot]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged;
}

async function fetchListing(
  url: string,
  limit: number,
  headers: Record<string, string>,
): Promise<RedditPost[]> {
  const res = await fetch(`${url}?limit=${limit}&raw_json=1`, { headers });
  if (!res.ok) {
    throw new Error(`Reddit fetch failed: ${url} -> HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data: { children: { data: Record<string, unknown> }[] };
  };
  return json.data.children.map((c) => {
    const d = c.data;
    return {
      id: String(d.id),
      subreddit: String(d.subreddit),
      title: String(d.title ?? ""),
      selftext: String(d.selftext ?? ""),
      score: Number(d.score ?? 0),
      numComments: Number(d.num_comments ?? 0),
      createdUtc: Number(d.created_utc ?? 0),
      permalink: `https://reddit.com${String(d.permalink ?? "")}`,
      url: String(d.url ?? ""),
      isSelf: Boolean(d.is_self),
    };
  });
}
