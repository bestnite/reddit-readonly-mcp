// 所有面向 agent 的字符串（工具描述、参数说明、错误信息）集中在这里，统一使用英文。

export const SERVER_INSTRUCTIONS = `Reddit MCP server (unofficial).
Read tools use an anonymous, application-only token and only see PUBLIC data. They work without any Reddit credentials.
Write tools (create_post, reply_to_post, edit_*, delete_*) and the get_me / get_my_* tools need a registered Reddit app plus account credentials (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD).
Listing tools return {"data": [...], "after": "<cursor>"}; pass "after" back to get the next page (null = no more pages).
Call "doctor" first if anything fails: it shows which backend is live (mobile / installed / rss), rate-limit state and write readiness.
There are no voting or private-messaging tools by design (Reddit Responsible Builder Policy). Do not use these tools to manipulate votes or karma, evade bans, or spam.`;

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
  linkId: "The post the stubs belong to: base36 id, 't3_' fullname or permalink URL.",
  commentIds: "Comment ids from a 'more' stub returned by get_post_comments (base36, with or without t1_).",
  title: "Post title (1-300 characters; cannot be edited later).",
  postContent:
    "For a text post (is_self=true): the body, Reddit markdown supported. For a link post (is_self=false): the URL.",
  isSelf: "true = text post using content as body (default); false = link post using content as URL.",
  flairId: "Optional flair template id (see get_post_flairs).",
  flairText: "Optional flair text (only for flair templates that allow custom text).",
  replyParent:
    "Thing to reply to: 't3_<id>' for a post (top-level comment) or 't1_<id>' for a comment (nested reply). A bare id is treated as a post id.",
  replyContent: "Reply body; Reddit markdown supported.",
  thingIdPost: "The post: 't3_<id>' or bare base36 id. Must be your own post.",
  thingIdComment: "The comment: 't1_<id>' or bare base36 id. Must be your own comment.",
  newText: "Replacement body text; fully overwrites the existing text. Reddit markdown supported.",
} as const;

// ---------------------------------------------------------------------------
// 工具描述
// ---------------------------------------------------------------------------
const LISTING_NOTE = 'Returns {"data": [...], "after": cursor|null}.';
const CREDS_NOTE =
  "Requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME and REDDIT_PASSWORD (registered Reddit app + account).";

export const TOOL_DESCRIPTIONS = {
  get_reddit_post:
    "Fetch a single Reddit post by id: title, author, subreddit, score, comment count, created time, permalink, link URL and body text (truncated if very long). Read-only, anonymous. Use get_post_comments for the discussion.",
  get_top_posts: `Top posts of a subreddit (or the anonymous front page) over a time window (default week). Read-only, anonymous. ${LISTING_NOTE} Also works in RSS fallback mode (max ~25 posts, no score/comment counts, no pagination).`,
  browse_subreddit: `Browse a subreddit feed sorted by hot/new/top/rising/controversial. Read-only, anonymous. ${LISTING_NOTE} Also works in RSS fallback mode for hot/new/top/rising (max ~25 posts, no score/comment counts, no pagination).`,
  search_reddit: `Search Reddit posts (or subreddits/users via 'type'), optionally restricted to one subreddit. Read-only, anonymous. ${LISTING_NOTE}`,
  get_user_info:
    "Public profile of a Reddit user: karma, account creation time, employee/mod/verified flags, profile description. Read-only, anonymous; private data is never available here (use get_me for your own account).",
  get_user_posts: `Posts submitted by a user. Read-only, anonymous. ${LISTING_NOTE}`,
  get_user_comments: `Comments written by a user, with the title of the post each one belongs to. Read-only, anonymous. ${LISTING_NOTE}`,
  get_subreddit_info:
    "Subreddit metadata: title, public description, subscribers, active users, creation time, NSFW flag, submission type. Read-only, anonymous.",
  get_subreddit_rules:
    "The posting rules of a subreddit (short name, description, which content kinds they apply to). Read-only, anonymous. Check this before create_post.",
  get_trending_subreddits: `Currently popular subreddits (Reddit's /subreddits/popular listing). Read-only, anonymous. ${LISTING_NOTE}`,
  get_post_comments:
    'The comment tree of a post. Returns {"post": {...}, "data": [comments with nested "replies"], "more": [stubs], "after": null}. Collapsed branches are listed in "more" (parent_id, count, children ids) and counted on the parent comment as "more_replies"; expand them with get_more_comments (stubs with continue_thread=true need the parent comment\'s permalink instead). Read-only, anonymous.',
  get_more_comments:
    "Expand 'more' stubs from get_post_comments via Reddit's /api/morechildren. Returns a flat list of comments with parent_id. Note: Reddit currently answers this endpoint with HTTP 403 for anonymous tokens; when user credentials are configured the call is retried with the user token.",
  get_post_flairs:
    "Link flair templates available in a subreddit (id, text, whether text is editable). Reddit usually requires a logged-in user for this; with user credentials configured the user token is used, otherwise a clean error is returned.",
  get_me: `Your own authenticated account (name, karma, creation time). ${CREDS_NOTE}`,
  get_my_overview: `Your own recent posts and comments, newest first. ${CREDS_NOTE} ${LISTING_NOTE}`,
  get_my_saved: `Posts and comments you have saved. ${CREDS_NOTE} ${LISTING_NOTE}`,
  create_post: `Publish a new text or link post. Mutating and NOT idempotent: every call creates another public post. ${CREDS_NOTE} Check get_subreddit_rules (and get_post_flairs if flair is required) first. Subject to safe mode (write delay, duplicate and cross-subreddit duplicate rejection) and optional bot disclosure footer.`,
  reply_to_post: `Post a public comment under a post (t3_) or reply to a comment (t1_). Mutating and NOT idempotent. ${CREDS_NOTE} Subject to safe mode and optional bot disclosure footer.`,
  edit_post: `Replace the body of one of your own text posts (titles and link posts cannot be edited). ${CREDS_NOTE} Idempotent: repeating the same edit is allowed. Subject to the safe-mode write delay and hourly cap, and the optional bot disclosure footer.`,
  edit_comment: `Replace the text of one of your own comments. ${CREDS_NOTE} Idempotent: repeating the same edit is allowed. Subject to the safe-mode write delay and hourly cap, and the optional bot disclosure footer.`,
  delete_post: `PERMANENTLY delete one of your own posts. This cannot be undone. ${CREDS_NOTE} Subject to safe mode write delay.`,
  delete_comment: `PERMANENTLY delete one of your own comments. This cannot be undone. ${CREDS_NOTE} Subject to safe mode write delay.`,
  doctor:
    "Diagnostics, no arguments: which read backend is live (mobile / installed / rss), whether it has degraded, token expiry, Reddit rate-limit remaining/reset, write readiness (which env vars are set, never their values), safe mode and cache stats. Call this first when other tools fail.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;

// ---------------------------------------------------------------------------
// 错误信息
// ---------------------------------------------------------------------------
export const E = {
  missingWriteCreds: (tool: string, missing: string[]) =>
    `${tool} is unavailable: missing ${missing.join(", ")}. ` +
    "Write operations and account tools need a registered Reddit app (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET) plus account credentials (REDDIT_USERNAME, REDDIT_PASSWORD). " +
    "The anonymous mobile-spoofed token used for reading is read-only by design and is never used for writes or account actions.",
  mobileIdForUserGrant:
    "Refusing to request a user token: REDDIT_CLIENT_ID equals the Android client id used for anonymous reads. Register your own Reddit app (https://www.reddit.com/prefs/apps, type 'script') and use its client id/secret.",
  userAuthRejected: (detail: string) =>
    `Reddit rejected the account credentials (${detail}). Check REDDIT_USERNAME / REDDIT_PASSWORD and that REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET belong to a 'script' app owned by or authorised for this account. Accounts with 2FA cannot use the password grant.`,
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
  forbiddenAnonymous: (what: string) =>
    `Reddit refused anonymous access (HTTP 403) to ${what}. This endpoint needs a logged-in user; configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME and REDDIT_PASSWORD to retry it with a user token.`,
  userRequired: (what: string) =>
    `Reddit requires a logged-in user for ${what} (USER_REQUIRED). Configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME and REDDIT_PASSWORD.`,
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
  safeDuplicate:
    "Safe mode rejected this write: identical content was posted recently. Reddit's spam filter may ban accounts for repeated content; change the content or set REDDIT_SAFE_MODE=off if you are sure.",
  safeCrossSubreddit: (prev: string, next: string) =>
    `Safe mode rejected this write: the same content was already posted to r/${prev}. Reddit's Responsible Builder Policy prohibits posting identical content across subreddits (r/${next}); write unique content per subreddit.`,
  safeHourlyCap: (cap: number, mode: string) =>
    `Safe mode (${mode}) rejected this write: the limit of ${cap} write operations per hour was reached. Wait before writing again.`,
  internal: (detail: string) => `Internal error: ${detail}`,
} as const;
