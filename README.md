**English** | [简体中文](README.zh-CN.md)

# reddit-mcp

An unofficial [Model Context Protocol](https://modelcontextprotocol.io) server for Reddit that can **read public
Reddit data from a datacenter / VPS IP without any Reddit API credentials**. It obtains an anonymous,
application-only token the same way Reddit's official Android app does (the technique used by
[redlib](https://github.com/redlib-org/redlib), MIT) and talks to `oauth.reddit.com`.

**The server is read-only.** It exposes twelve tools that read public posts, comments, users and subreddits. There
are no tools that post, reply, edit, delete, vote, send messages or read account data, and it never asks for Reddit
credentials. The read tools' names and semantics follow
[jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server), so read-only prompts written for one
work with the other.

## ⚠️ Risks — read this first

- **This server is read-only by design.** Write tools were deliberately removed. Posting, replying and voting need a
  user-context token, which would mean either a registered Reddit app (self-service app creation closed in
  November 2025; approval is now required) or handing your Reddit account credentials to this tool. Neither is in
  scope, so no code path accepts a Reddit username, password or app secret.
- **The client id `ohXpoqrZYub1kg` is a public constant of Reddit's Android app.** Impersonating the official
  Android client conflicts with Reddit's Responsible Builder Policy, and Reddit can revoke or change this id at any
  time. When it breaks, override it with `REDDIT_MOBILE_CLIENT_ID`; meanwhile the cascade falls back to RSS for the
  two RSS-capable tools.
- **The spoofed identity only ever reads public data.** It yields an anonymous, application-only token; nothing the
  server does acts on behalf of a Reddit account.
- **No uptime or correctness guarantee.** This is an unofficial client hitting undocumented endpoints; any of them can
  change or disappear without notice.

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
npm run build

# stdio (default) — what MCP clients launch
npx reddit-mcp            # or: node dist/cli.js

# Streamable HTTP on http://127.0.0.1:3000/mcp (+ GET /health)
npx reddit-mcp --http --port 3000 --host 127.0.0.1
```

The npm package name is `reddit-mobile-mcp` (`reddit-mcp` is already taken on npm); the executable it
installs is `reddit-mcp`, so once published the command would be `npx reddit-mobile-mcp`.

Example MCP client entry (stdio), using an absolute path to your checkout:

```json
{
  "mcpServers": {
    "reddit": { "command": "node", "args": ["/path/to/reddit-mcp/dist/cli.js"] }
  }
}
```

In stdio mode nothing but MCP protocol messages is written to stdout; all logs go to stderr. The HTTP transport
binds to loopback by default and rejects requests whose `Host` header is not a loopback name (DNS-rebinding
protection). Idle HTTP sessions are closed after 30 minutes. It has **no authentication** — don't bind it to a public interface unless something else protects it.

## How reading works

| Step | Backend | What happens |
|---|---|---|
| 1 | `mobile` | `POST https://www.reddit.com/auth/v2/oauth/access-token/loid`, HTTP Basic `<android client id>:` (empty password), JSON body `{"scopes":["*","email","pii"]}`, Android headers. Returns a 24 h token plus `x-reddit-loid` / `x-reddit-session`, which are sent on every later request. |
| 2 | `installed` | After **5 consecutive** `mobile` failures: `POST https://www.reddit.com/api/v1/access_token` with the `installed_client` grant and the same Basic auth. |
| 3 | `rss` | After 5 more failures: public RSS feeds. Only `browse_subreddit` and `get_top_posts` keep working (max ~25 entries, no scores / comment counts / pagination); every other tool returns an error that says so. |
| 4 | — | If RSS fails too, tools return an actionable error — never a silent wrong answer. |

Details:

- One Android device identity (random real app version from redlib's list, Android 9–14, uuid for
  `client-vendor-id` / `X-Reddit-Device-Id`) is generated per process and reused for every request.
- The token is cached in memory and refreshed **2 minutes before** it expires. Only one refresh runs at a time.
- Only HTTP-level rejections (4xx/5xx, malformed token response) count as backend failures. Pure network errors and
  timeouts fail the current call with a network error and do **not** push the cascade towards RSS (RSS lives on the
  same host, so degrading would not help). Token requests time out after at most 10 s.
- `x-ratelimit-remaining` is tracked on every response; at **≤ 5** the token is rolled over (a fresh token gets a
  fresh ~100-request window). A `429` on an anonymous read first triggers the same rollover; after that `429` is
  retried up to `REDDIT_MAX_RETRIES` times, honouring `Retry-After`. On `401` the token is refreshed and the request
  retried once.
- After degrading, the server re-tries the better backends (mobile, then installed) every 30 minutes and switches back
  when one works.
- Tokens, `x-reddit-loid` and `x-reddit-session` are never logged or returned (logs and tool output are additionally
  passed through a redaction filter).
- `REDDIT_AUTH_MODE=mobile|installed|rss` pins one backend and disables the cascade.

## Configuration

All environment variables are optional. There are no credential variables: Reddit app ids / secrets and account
usernames / passwords are not read.

| Variable | Default | Meaning |
|---|---|---|
| `REDDIT_AUTH_MODE` | `auto` | `auto` / `mobile` / `installed` / `rss` |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android client id (override point if it gets revoked) |
| `REDDIT_CACHE` | `on` | In-memory read cache `on` / `off` |
| `REDDIT_CACHE_MAX_MB` | `50` | LRU cap |
| `REDDIT_MAX_RETRIES` | `3` | Retries on 429 honouring `Retry-After` |
| `REDDIT_TIMEOUT_MS` | `20000` | Per-request timeout |
| `REDDIT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent` (stderr) |

## Tools

Exactly twelve tools, all read-only and anonymous (annotated `readOnlyHint: true`). Listing tools take `limit` and
(where Reddit supports it) `after`, and return `{"data": [...], "after": cursor|null}` with trimmed fields (id,
fullname, title, author, subreddit, score, num_comments, ISO `created_utc`, permalink, url, truncated selftext/body) —
never the raw Reddit JSON.

| Tool | Notes |
|---|---|
| `get_reddit_post` | One post by id / fullname / permalink URL |
| `get_top_posts` | `subreddit?`, `time_filter` (default week). **Works over RSS.** |
| `browse_subreddit` | `sort`: hot/new/top/rising/controversial, `time_filter` for top/controversial. **Works over RSS** (except controversial). |
| `search_reddit` | `query` (alias `q`), optional `subreddit`, `sort`, `time_filter`, `type` (link/sr/user) |
| `get_post_comments` | `limit`, `depth`, `sort`; nested replies + `more` stubs. The `more` stubs **cannot be expanded** by this server: Reddit answers `/api/morechildren` with HTTP 403 for anonymous tokens. Request a larger `limit` / `depth` instead. |
| `get_user_info` | Public profile |
| `get_user_posts` / `get_user_comments` | `sort`, `time_filter`, pagination |
| `get_subreddit_info` | Metadata and sidebar |
| `get_subreddit_rules` | Posting rules |
| `get_trending_subreddits` | Reddit's `/subreddits/popular` |
| `doctor` | Diagnostics, no arguments: active backend, whether the cascade degraded (and why), token expiry, current `x-ratelimit-remaining` / reset window / rollovers, cache and request stats. Call it first when other tools fail. |

Not provided, by design:

- **Writes** (posting, replying, editing, deleting) and **account tools** (your profile, saved items, overview) —
  they need a user identity; see *Risks*.
- **Voting and private messaging** (Responsible Builder Policy).
- **Expanding `more` stubs** (`/api/morechildren` → 403 for anonymous tokens) and **link flair templates**
  (`/r/<sub>/api/link_flair_v2` → `USER_REQUIRED` for anonymous tokens). They are not routed through other endpoints.

## Development

```bash
npm run build      # tsup -> dist/cli.js
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest unit tests, no network
npm run smoke      # LIVE test of all 12 tools against real Reddit (network)
npm run wire       # starts dist/cli.js and checks the stdio + HTTP protocol exchange (network for doctor)
```

See [AGENTS.md](AGENTS.md) for the code map and conventions.

## License

MIT. The Android app version list in `src/auth/android-app-versions.ts` is copied from redlib (MIT).
