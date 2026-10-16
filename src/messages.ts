// 所有面向 agent 的字符串（工具描述、参数说明、错误信息）集中在这里，统一使用英文。

export const SERVER_INSTRUCTIONS = `Reddit MCP server (unofficial).
This server is READ-ONLY by design: every tool uses an anonymous, application-only token and only sees PUBLIC data. No Reddit credentials are needed or accepted.
There are no tools that post, reply, edit, delete, vote, message or read account data; do not ask the user for Reddit credentials.
Listing tools return {"data": [...], "after": "<cursor>"}; pass "after" back to get the next page (null = no more pages).
Call "doctor" first if anything fails: it shows which backend is live (mobile / installed / rss), rate-limit state and cache stats.
Do not use these tools to evade bans or to collect data in violation of Reddit's policies.`;

// ---------------------------------------------------------------------------
// 参数说明（多个工具共用）
// ---------------------------------------------------------------------------
export const P = {
  subreddit: "Subreddit name without the r/ prefix (e.g. 'LocalLLaMA'). 'r/LocalLLaMA' is also accepted.",
  subredditOptional:
    "Subreddit name without the r/ prefix (e.g. 'LocalLLaMA'). Omit for Reddit's default anonymous front page.",
  subredditName: "Subreddit name without the r/ prefix (e.g. 'AskReddit').",
  username: "Reddit username without the u/ prefix (e.g. 'spez').",
  postId:
    "Post id: base36 id ('1abc23'), fullname ('t3_1abc23'), or a full reddit.com permalink URL.",
  limit: (def: number, max = 100) => `How many items to return, 1-${max} (default ${def}).`,
  after: "Pagination cursor: the 'after' value returned by a previous call. Omit for the first page.",
  timeFilter: "Time window: hour, day, week, month, year or all.",
  listingSort: "Feed ordering: hot (default), new, top, rising or controversial. top/controversial honour time_filter.",
  userSort: "Ordering: new (default), hot, top or controversial. top/controversial honour time_filter.",
  searchQuery:
    "Search terms; Reddit operators work (\"exact phrase\", author:name, self:yes, flair:x). Must be non-empty.",
  searchQueryAlias: "Alias of 'query' (Reddit's own parameter name). Provide either 'query' or 'q'.",
  searchSubreddit: "Restrict results to this subreddit (without r/). Omit to search all of Reddit.",
  searchSort: "Sort: relevance (default), hot, top, new or comments.",
  searchType: "What to search for: link = posts (default), sr = subreddits, user = users.",
  commentSort: "Comment ordering: confidence/best (default), top, new, controversial, old, qa.",
  commentDepth: "Maximum reply nesting depth to return, 1-10 (default 5). Deeper replies become 'more' stubs.",
  commentLimit: "Maximum number of comments Reddit should return, 1-500 (default 100).",
} as const;

// ---------------------------------------------------------------------------
// 工具描述
// ---------------------------------------------------------------------------
const LISTING_NOTE = 'Returns {"data": [...], "after": cursor|null}.';

export const TOOL_DESCRIPTIONS = {
  get_reddit_post:
    "Fetch a single Reddit post by id: title, author, subreddit, score, comment count, created time, permalink, link URL and body text (truncated if very long). Read-only, anonymous. Use get_post_comments for the discussion.",
  get_top_posts: `Top posts of a subreddit (or the anonymous front page) over a time window (default week). Read-only, anonymous. ${LISTING_NOTE} Also works in RSS fallback mode (max ~25 posts, no score/comment counts, no pagination).`,
  browse_subreddit: `Browse a subreddit feed sorted by hot/new/top/rising/controversial. Read-only, anonymous. ${LISTING_NOTE} Also works in RSS fallback mode for hot/new/top/rising (max ~25 posts, no score/comment counts, no pagination).`,
  search_reddit: `Search Reddit posts (or subreddits/users via 'type'), optionally restricted to one subreddit. Read-only, anonymous. ${LISTING_NOTE}`,
  get_user_info:
    "Public profile of a Reddit user: karma, account creation time, employee/mod/verified flags, profile description. Read-only, anonymous; private account data is never available.",
  get_user_posts: `Posts submitted by a user. Read-only, anonymous. ${LISTING_NOTE}`,
  get_user_comments: `Comments written by a user, with the title of the post each one belongs to. Read-only, anonymous. ${LISTING_NOTE}`,
  get_subreddit_info:
    "Subreddit metadata: title, public description, subscribers, active users, creation time, NSFW flag, submission type. Read-only, anonymous.",
  get_subreddit_rules:
    "The posting rules of a subreddit (short name, description, which content kinds they apply to). Read-only, anonymous.",
  get_trending_subreddits: `Currently popular subreddits (Reddit's /subreddits/popular listing). Read-only, anonymous. ${LISTING_NOTE}`,
  get_post_comments:
    'The comment tree of a post. Returns {"post": {...}, "data": [comments with nested "replies"], "more": [stubs], "after": null}. Collapsed branches are listed in "more" (parent_id, count, children ids) and counted on the parent comment as "more_replies". These "more" stubs CANNOT be expanded by this server: Reddit answers /api/morechildren with HTTP 403 for anonymous tokens, so do not expect a follow-up call to retrieve them. To see more of a thread, call get_post_comments again with a larger limit/depth or a different sort. Read-only, anonymous.',
  doctor:
    "Diagnostics, no arguments: which read backend is live (mobile / installed / rss), whether it has degraded, token expiry, Reddit rate-limit remaining/reset, and cache/request stats. Call this first when other tools fail.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;

// ---------------------------------------------------------------------------
// 错误信息
// ---------------------------------------------------------------------------
export const E = {
  rssUnsupported: (tool: string) =>
    `${tool} is unavailable: the server is running on the RSS fallback backend, and RSS feeds cannot provide this data (only browse_subreddit and get_top_posts work over RSS). ` +
    "Run doctor to see why the token backends failed; set REDDIT_AUTH_MODE=auto (or mobile/installed) once Reddit's token endpoint works again.",
  rssSortUnsupported: (sort: string) =>
    `Sort '${sort}' is not available over RSS (RSS fallback supports hot, new, top and rising).`,
  rssPaginationUnsupported:
    "Pagination ('after') is not available on the RSS fallback backend; only the first ~25 entries can be returned.",
  allBackendsFailed: (detail: string) =>
    `Could not reach Reddit through any backend (mobile token, installed-client token, RSS). Last error: ${detail}. ` +
    "If the Android client id was revoked, set REDDIT_MOBILE_CLIENT_ID to a working id; check network access to www.reddit.com and oauth.reddit.com; run doctor for details.",
  pinnedBackendFailed: (backend: string, detail: string) =>
    `The '${backend}' token backend (pinned by REDDIT_AUTH_MODE=${backend}) failed: ${detail}. ` +
    "Set REDDIT_AUTH_MODE=auto to allow fallback, or REDDIT_MOBILE_CLIENT_ID if the Android client id was revoked. Run doctor for details.",
  rssPinnedFailed: (detail: string) =>
    `The RSS backend (pinned by REDDIT_AUTH_MODE=rss) failed: ${detail}. Reddit throttles RSS aggressively (HTTP 429); wait a minute, or set REDDIT_AUTH_MODE=auto to use the token backends.`,
  notFound: (what: string) => `Not found: ${what}. It may not exist, be deleted, or be private/banned.`,
  forbidden: (what: string) =>
    `Reddit refused access (HTTP 403) to ${what}. The content may be private, quarantined, or the endpoint may require a logged-in user.`,
  userRequired: (what: string) =>
    `Reddit requires a logged-in user for ${what} (USER_REQUIRED). This server is read-only and anonymous by design, so this data is not available through it.`,
  redirected: (what: string) =>
    `Reddit redirected the request for ${what}; this usually means the subreddit or user does not exist.`,
  rateLimited: (seconds: number | null) =>
    `Reddit rate limit hit (HTTP 429) and retries were exhausted.${seconds !== null ? ` Try again in about ${Math.ceil(seconds)} s.` : ""} Run doctor to see the current window.`,
  timeout: (ms: number) => `Reddit did not answer within ${ms} ms (REDDIT_TIMEOUT_MS). Try again later.`,
  network: (detail: string) => `Network error talking to Reddit: ${detail}`,
  http: (status: number, what: string) => `Reddit returned HTTP ${status} for ${what}.`,
  redditApi: (what: string, errors: string) => `Reddit rejected ${what}: ${errors}`,
  invalidInput: (detail: string) => `Invalid input: ${detail}`,
  invalidSubreddit: (v: string) => `Invalid subreddit name ${JSON.stringify(v)}.`,
  invalidUsername: (v: string) => `Invalid username ${JSON.stringify(v)}.`,
  invalidId: (v: string, kind: string) => `Invalid ${kind} id ${JSON.stringify(v)}.`,
  searchQueryMissing: "Provide a non-empty 'query' (or its alias 'q').",
  internal: (detail: string) => `Internal error: ${detail}`,
} as const;
