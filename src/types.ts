/** One candidate story, regardless of which source (RSS or redditapis.com) it came from. */
export interface Candidate {
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  externalUrl?: string;
  publishedAt?: string;
  /** Only available via redditapis.com, not the free RSS fallback. */
  upvotes?: number;
  numComments?: number;
  topComments?: { author: string; score: number; body: string }[];
  /**
   * Pinned by the subreddit's mods — could mean permanent housekeeping
   * (rules, a daily discussion thread) or exactly the opposite: a trade or
   * major-news megathread mods pin *because* it's the story, often the single
   * highest-engagement thread that day. Left for the drafting prompt to judge
   * by title/content rather than filtered out here — see src/voice.ts.
   */
  stickied?: boolean;
}
