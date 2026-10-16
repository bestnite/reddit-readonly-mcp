**English** | [简体中文](README.zh-CN.md)

# reddit-mcp

An unofficial [Model Context Protocol](https://modelcontextprotocol.io) server for Reddit that can **read public
Reddit data from a datacenter / VPS IP without any Reddit API credentials**. It obtains an anonymous,
application-only token the same way Reddit's official Android app does (the technique used by
[redlib](https://github.com/redlib-org/redlib), MIT) and talks to `oauth.reddit.com`.

The tool names and semantics follow [jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server),
so prompts written for one work with the other. Optional write tools are available when you supply your own
registered Reddit app and account.

## ⚠️ Risks — read this first

- **The client id `ohXpoqrZYub1kg` is a public constant of Reddit's Android app.** Impersonating the official
  Android client conflicts with Reddit's Responsible Builder Policy, and Reddit can revoke or change this id at any time. When it breaks, override it with `REDDIT_MOBILE_CLIENT_ID`,
  or use a registered app.
- **The spoofed identity is used for the read path of public data only.** It is never used for write operations or
  account actions; the code refuses to combine the Android client id with a username/password. Writes go only through
  your own `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` + `REDDIT_USERNAME` / `REDDIT_PASSWORD`.
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
- Tokens, `x-reddit-loid`, `x-reddit-session` and credentials are never logged or returned (logs and tool output are
  additionally passed through a redaction filter).
- `REDDIT_AUTH_MODE=mobile|installed|rss` pins one backend and disables the cascade.

## Configuration

All environment variables are optional.

| Variable | Default | Meaning |
|---|---|---|
| `REDDIT_AUTH_MODE` | `auto` | `auto` / `mobile` / `installed` / `rss` |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android client id (override point if it gets revoked) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | – | Your registered Reddit app ("script" type), required for write ops |
| `REDDIT_USERNAME` / `REDDIT_PASSWORD` | – | Account, required for write ops |
| `REDDIT_SAFE_MODE` | `standard` | `off` / `standard` / `strict` |
| `REDDIT_BOT_DISCLOSURE` | `off` | `auto` / `off` |
| `REDDIT_BOT_FOOTER` | built-in | Custom footer text used when disclosure is `auto` |
| `REDDIT_CACHE` | `on` | In-memory read cache `on` / `off` |
| `REDDIT_CACHE_MAX_MB` | `50` | LRU cap |
| `REDDIT_MAX_RETRIES` | `3` | Retries on 429 honouring `Retry-After` |
| `REDDIT_TIMEOUT_MS` | `20000` | Per-request timeout |
| `REDDIT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent` (stderr) |

## Tools

Listing tools take `limit` and (where Reddit supports it) `after`, and return `{"data": [...], "after": cursor|null}`
with trimmed fields (id, fullname, title, author, subreddit, score, num_comments, ISO `created_utc`, permalink, url,
truncated selftext/body) — never the raw Reddit JSON.

### Read (anonymous)

| Tool | Notes |
|---|---|
| `get_reddit_post` | One post by id / fullname / permalink URL |
| `get_top_posts` | `subreddit?`, `time_filter` (default week). **Works over RSS.** |
| `browse_subreddit` | `sort`: hot/new/top/rising/controversial, `time_filter` for top/controversial. **Works over RSS** (except controversial). |
| `search_reddit` | `query` (alias `q`), optional `subreddit`, `sort`, `time_filter`, `type` (link/sr/user) |
| `get_user_info` | Public profile |
| `get_user_posts` / `get_user_comments` | `sort`, `time_filter`, pagination |
| `get_subreddit_info` | Metadata and sidebar |
| `get_subreddit_rules` | Posting rules |
| `get_trending_subreddits` | Reddit's `/subreddits/popular` |
| `get_post_comments` | `limit`, `depth`, `sort`; nested replies + `more` stubs |
| `get_more_comments` | Expands `more` stubs via `/api/morechildren`. Reddit currently answers this with **403 for anonymous tokens**; with user credentials configured the same endpoint is retried with the user token. |
| `get_post_flairs` | Reddit requires a logged-in user (`USER_REQUIRED`); uses the user token when configured, otherwise returns a clean error. |

### Account (user credentials required)

`get_me`, `get_my_overview`, `get_my_saved` — return a clear error naming the missing variables when credentials are
absent.

### Write (user credentials required)

`create_post` (text/link, optional flair), `reply_to_post`, `edit_post`, `edit_comment`, `delete_post`,
`delete_comment` (deletes are **permanent**). Every write needs all four of `REDDIT_CLIENT_ID`,
`REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`; the password grant is requested with *your* app, never
with the Android client id. Accounts with 2FA cannot use the password grant.

There are deliberately **no voting or private-messaging tools** (Responsible Builder Policy).

#### Safe mode

| Mode | Min delay between writes | Duplicate / cross-subreddit check | History | Writes per hour |
|---|---|---|---|---|
| `off` | – | – | – | unlimited |
| `standard` (default) | 2 s | yes | last 10 | 30 |
| `strict` | 5 s | yes | last 20 | 10 |

Identical content (case/whitespace-insensitive) posted again via `create_post` / `reply_to_post` is rejected; the
same content sent to a different subreddit is rejected as cross-posting. Edits and deletes only get the delay and the
hourly cap (repeating an edit is idempotent). Writes are serialised. With `REDDIT_BOT_DISCLOSURE=auto` a footer is appended
to text posts, replies and edits.

### Diagnostics

`doctor` (no arguments): active backend, whether the cascade degraded (and why), token expiry, current
`x-ratelimit-remaining` / reset window / rollovers, write readiness (which env vars are set — never their values),
safe mode, cache and request stats.

## Development

```bash
npm run build      # tsup -> dist/cli.js
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest unit tests, no network
npm run smoke      # LIVE test against real Reddit (network)
npm run wire       # starts dist/cli.js and checks the stdio + HTTP protocol exchange (network for doctor)
```

See [AGENTS.md](AGENTS.md) for the code map and conventions.

## License

MIT. The Android app version list in `src/auth/android-app-versions.ts` is copied from redlib (MIT).
