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
}
