# SPEC — reddit-mcp: a Reddit MCP server that works from a datacenter IP with no Reddit app credentials

You are implementing this project from scratch. Read this whole file first, then build it.
Nothing about the surrounding conversation is available to you — everything you need is here.

## 1. Goal

Build a **TypeScript MCP (Model Context Protocol) server** for Reddit that works **from a
datacenter/VPS IP address without any Reddit API credentials**, by impersonating Reddit's official
Android client (the technique used by [redlib](https://github.com/redlib-org/redlib), MIT).

- Tool surface and behaviour are modelled on
  [jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server): read tools
  plus write tools, safe mode, bot disclosure.
- Distribution: `npx reddit-mcp` must work (package `bin` entry), plus an HTTP transport mode.
- This is a **local, private** project for now: no npm publish, no pushing to a remote.

**Hard constraint (do not violate):** the spoofed Android client identity is used **only** to obtain
an *application-only, anonymous* token for **reading public data**. Never use the Android client id
with a username/password to obtain a user token. Write operations must go through the normal
`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` + `REDDIT_USERNAME` / `REDDIT_PASSWORD` path (see §4.4),
and must fail with a clear error when those are absent.

## 2. Verified facts (measured on the target machine — treat as ground truth)

These were confirmed by live requests before this spec was written. Do not re-derive them; do not
"fix" them.

| Item | Value |
|---|---|
| Token endpoint (primary) | `POST https://www.reddit.com/auth/v2/oauth/access-token/loid` |
| Token request auth | HTTP Basic: base64(`<android_client_id>:`) — client id, empty password |
| Token request body | JSON `{"scopes":["*","email","pii"]}` |
| Token response | JSON `{"access_token":"...","expires_in":86400}` + headers `x-reddit-loid`, `x-reddit-session` |
| Android client id | `ohXpoqrZYub1kg` (overridable via env, see §4.3) |
| API base after auth | `https://oauth.reddit.com` (paths like `/r/<sub>/hot`) |
| Fallback token endpoint | `POST https://www.reddit.com/api/v1/access_token`, body `grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=<uuid>`, same Basic auth with an empty password |
| Rate limit | ~100 requests per window; response headers `x-ratelimit-used`, `x-ratelimit-remaining`, `x-ratelimit-reset` (seconds) |
| RSS (last resort) | `https://www.reddit.com/r/<sub>/.rss`, `.../hot.rss`, `.../new.rss`, `.../top.rss?t=day`, `https://www.reddit.com/search.rss?q=...` — HTTP 200 from the same IP |
| Blocked from the same IP | `www.reddit.com/…json`, `api.reddit.com`, `/svc/shreddit/...`, `old.reddit.com` → HTTP 403 |

Endpoints verified working with the spoofed token from that IP: `/{sub}/hot`, `/{sub}/top`,
`/{sub}/search?q=&restrict_sr=1`, `/comments/<id>`, `/comments/<id>?limit=&depth=`,
`/user/<name>/about`, `/user/<name>/submitted`, `/subreddits/search?q=`, `/{sub}/about/rules`,
and listing pagination via `?after=<fullname>`.

### Android request headers to send (all requests, token request included)

Ported from redlib `src/oauth.rs` + `src/oauth_resources.rs`:

- `User-Agent: Reddit/Version <ver>/Build <build>/Android <n>` where `<ver>/<build>` is picked at
  random from a list of **real** Android app versions, and `<n>` is a random Android major version
  in `9..=14`. Seed the list from redlib's `ANDROID_APP_VERSION_LIST` (150 entries,
  `https://raw.githubusercontent.com/redlib-org/redlib/main/src/oauth_resources.rs`) — copy the
  entries into a data file; do not invent version strings.
- `x-reddit-retry: algo=no-retries`
- `x-reddit-compression: 1`
- `x-reddit-qos: <float with 3 decimals, e.g. "12.345">`
- `x-reddit-media-codecs: <one of: available-codecs=video/avc, video/hevc, video/x-vnd.on2.vp9>`
- `Content-Type: application/json; charset=UTF-8`
- `client-vendor-id: <uuid v4>` and `X-Reddit-Device-Id: <same uuid>` — one device identity per
  process, generated once and reused for every request in that process.
- After the token response: store `x-reddit-loid` and `x-reddit-session` and send them on all
  subsequent API requests.

## 3. Project layout

```
~/mcp/reddit-mcp/
  package.json            # type: module, bin: {"reddit-mcp": "dist/cli.js"}, engines.node >=20
  tsconfig.json           # strict
  src/cli.ts              # arg parsing (--http, --port, --host), starts one of the two transports
  src/server.ts           # builds the McpServer and registers all tools
  src/transport/stdio.ts
  src/transport/http.ts   # streamable HTTP at POST/GET /mcp (plus /health)
  src/auth/token-manager.ts   # the mobile-spoof / installed_client token dance + cache + rollover
  src/auth/device.ts          # android device identity: headers, uuid, UA, app-version list
  src/auth/android-app-versions.ts   # data file copied from redlib
  src/auth/user-token.ts      # password-grant user token for write operations
  src/client/reddit-client.ts # oauth.reddit.com request wrapper: headers, rate limit, 429 backoff, cache
  src/client/rss.ts           # RSS fallback backend
  src/client/errors.ts        # typed errors -> MCP tool error text
  src/tools/index.ts          # tool registry
  src/tools/read/*.ts         # one file per read tool
  src/tools/write/*.ts        # one file per write tool
  src/tools/doctor.ts         # backend status / rate limit / degradation report
  src/write/safe-mode.ts      # rate limiting + duplicate + cross-subreddit detection
  src/write/bot-disclosure.ts # optional footer appended to posted content
  src/types.ts                # trimmed response types
  src/messages.ts             # all agent-facing strings (tool descriptions, errors) in one place
  tests/                      # vitest unit tests (no network)
  scripts/smoke.ts            # live smoke test against real Reddit (network)
  README.md, README.zh-CN.md, AGENTS.md, LICENSE (MIT)
```

Use `tsup` (or `tsc`) to build to `dist/`, ESM only. Dependencies: `@modelcontextprotocol/sdk`,
`zod`, `fast-xml-parser` (RSS). Dev: `typescript`, `vitest`, `tsup`, `tsx`. Keep the dependency list
small; no HTTP client library — use global `fetch`.

## 4. Authentication layer

### 4.1 Backend selection (`REDDIT_AUTH_MODE`, default `auto`)

Order in `auto` mode, each step only attempted after the previous fails:

1. **`mobile`** — the loid token endpoint (§2). Primary path.
2. **`installed`** — `/api/v1/access_token` with the `installed_client` grant. Used after **5
   consecutive `mobile` failures** (log a warning each switch, like redlib does).
3. **`rss`** — public RSS feeds. Read tools that RSS can serve keep working; the rest return a clear
   error naming the missing capability.
4. Otherwise: a clear, actionable error (never a silent wrong answer).

Explicit values (`mobile` / `installed` / `rss`) pin one backend and skip the cascade.
Expose which backend is live and whether the process has degraded, via the `doctor` tool.

### 4.2 Token lifecycle

- Cache the token in memory with its `expires_in`; refresh when **2 minutes** before expiry.
- Track `x-ratelimit-remaining` from every API response. When it drops to a low threshold
  (`<=5`), force a **token rollover**: fetch a fresh token, swap it in, and reset the counter — a
  new token gets a fresh window (~100 requests).
- A single in-flight refresh at a time (a promise lock), so concurrent tool calls never stampede the
  token endpoint.
- On `401`, force one refresh and retry the request once.
- Never log or return the token, `x-reddit-loid`, `x-reddit-session`, or the credentials.

### 4.3 Configuration (env, all optional)

| Var | Default | Meaning |
|---|---|---|
| `REDDIT_AUTH_MODE` | `auto` | `auto` / `mobile` / `installed` / `rss` |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android client id (override point if it gets revoked) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | – | Registered Reddit app, required for write ops |
| `REDDIT_USERNAME` / `REDDIT_PASSWORD` | – | Account, required for write ops |
| `REDDIT_SAFE_MODE` | `standard` | `off` / `standard` / `strict` |
| `REDDIT_BOT_DISCLOSURE` | `off` | `auto` / `off` |
| `REDDIT_BOT_FOOTER` | built-in | Custom footer text used when disclosure is `auto` |
| `REDDIT_CACHE` | `on` | In-memory read cache `on` / `off` |
| `REDDIT_CACHE_MAX_MB` | `50` | LRU cap |
| `REDDIT_MAX_RETRIES` | `3` | Retries on 429 honouring `Retry-After` |
| `REDDIT_TIMEOUT_MS` | `20000` | Per-request timeout |

### 4.4 Write operations

Write tools require a **user-context token**: `grant_type=password` against
`https://www.reddit.com/api/v1/access_token` with `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` and
`REDDIT_USERNAME`/`REDDIT_PASSWORD` (this is what reddit-mcp-server does). Refresh it on expiry and
keep it separate from the anonymous read token.

If any of the four vars is missing, every write tool must return an error that says exactly which
vars are missing, states that write operations need a registered Reddit app plus account
credentials, and points out that the anonymous mobile-spoofed token is read-only by design. Do
**not** attempt any workaround using the Android client id.

## 5. Tools

Names and semantics follow reddit-mcp-server so the two are interchangeable in prompts.

### Read (anonymous token; RSS covers a subset)

`get_reddit_post`, `get_top_posts`, `browse_subreddit` (`sort`: hot/new/top/rising/controversial,
`time_filter` for top/controversial), `search_reddit` (`q`, optional `subreddit`, `sort`),
`get_user_info`, `get_user_posts`, `get_user_comments`, `get_subreddit_info`,
`get_subreddit_rules`, `get_trending_subreddits`, `get_post_comments` (with `limit`, `depth`,
`sort`), `get_more_comments` (expand `more` stubs via `/api/morechildren`), `get_post_flairs`
(may 403 anonymously — return a clean error), `get_me`, `get_my_overview`, `get_my_saved`
(last three require user credentials and must error clearly without them).

Every listing tool takes `limit` and, where Reddit supports it, `after` for pagination, and returns
`{ data: [...], after: <cursor|null> }`. Return **trimmed** fields (id, fullname, title, author,
subreddit, score, num_comments, created_utc ISO, permalink, url, selftext/body truncated to a sane
length) — never the raw multi-hundred-KB Reddit JSON.

RSS-backed mode: `browse_subreddit` and `get_top_posts` keep working (up to ~25 entries, no score /
comment counts, no pagination); everything else errors out naming the reason.

### Write (user credentials required)

`create_post` (text/link, optional flair), `reply_to_post`, `edit_post`, `edit_comment`,
`delete_post`, `delete_comment`. Deleting must be described in the tool description as permanent.
All writes pass through safe mode and optional bot disclosure.

### Diagnostics

`doctor` — no arguments. Reports: active backend (`mobile` / `installed` / `rss`), whether the
cascade has degraded, token expiry, current `x-ratelimit-remaining` / reset window, write-op
readiness (which env vars are set, never their values), cache stats.

### Safe mode

`standard` (default): minimum delay between writes, reject identical sequential content, reject the
same content across different subreddits. `strict`: longer delays, lower thresholds. `off`: no
guards. Mirror reddit-mcp-server's behaviour and honour Reddit's Responsible Builder Policy: no
voting or private-messaging tools at all.

## 6. Transports

- **stdio** (default): `npx reddit-mcp` or `node dist/cli.js` — must never print anything to stdout
  that is not an MCP protocol message; all logging goes to **stderr**.
- **HTTP**: `--http [--port 3000] [--host 127.0.0.1]` exposing streamable HTTP MCP on `/mcp`
  (and `/health` for a plain liveness JSON). Bind to loopback by default.

## 7. Conventions (non-negotiable)

- All agent-facing strings — tool names, descriptions, error messages — in **English**, collected in
  `src/messages.ts` (there is no human UI, so no i18n framework needed; a single catalog file is
  enough).
- **Chinese code comments**, English logs and internal errors.
- No hardcoded absolute paths anywhere.
- Never log, print, or return tokens, credentials, or session headers.
- `README.md` (English) + `README.zh-CN.md` (Chinese) with a language-switch line at the top of each.
  `AGENTS.md` in English. README must document the config table, the tool list, and the risk
  section below.

## 8. Risks section (must appear prominently in both READMEs)

- The client id `ohXpoqrZYub1kg` is a public constant; impersonating the official Android app
  conflicts with Reddit's Responsible Builder Policy, and the id can be revoked at any time. When it
  breaks, override with `REDDIT_MOBILE_CLIENT_ID` or use a registered app.
- Provide the read path for public data only; never use the spoofed identity for write operations or
  account actions.
- No uptime or correctness guarantee: this is an unofficial client hitting undocumented endpoints.

## 9. Verification you must actually run (no fabricated output)

1. `npm run build` — must succeed.
2. `npm test` — unit tests (vitest) covering: token request construction (assert exact method, URL,
   Basic auth header, body, and the required Android headers, against a mocked fetch), token
   rollover at low rate limit, refresh 2 minutes before expiry, the mobile→installed→rss cascade,
   safe-mode duplicate/cross-subreddit rejection, and trimmed response shaping. No network in tests.
3. `npm run smoke` — a **live** script (`scripts/smoke.ts`) that, against real Reddit from this
   machine, exercises: `doctor`, `browse_subreddit r/LocalLLaMA --sort hot --limit 3`,
   `search_reddit "hermes" --subreddit LocalLLaMA --limit 3`, `get_post_comments` on a real post,
   `get_user_info spez`, `get_subreddit_rules LocalLLaMA`, and one RSS-mode fallback run
   (`REDDIT_AUTH_MODE=rss`). It must print a PASS/FAIL line per call and exit non-zero on any FAIL.
   Run it, and paste the real output in your final report.
4. Wire-protocol check: start the server over stdio, send a real `initialize` + `tools/list` +
   `tools/call` JSON-RPC sequence (a small script is fine), and confirm it answers with HTTP-free
   stdout containing only protocol messages. Do the same once over HTTP (`/health` plus an MCP
   initialize POST).

## 10. Working style

- `git init` in the project directory, and commit in small conventional commits (`feat:`, `test:`,
  `docs:`, `chore:`) as you complete each part. No remote.
- Maintain `PROGRESS.local.md` (gitignored) as a checklist: one line per work item with a status
  (`todo` / `doing` / `done`) and the commit id when done. Keep it current — it is the audit trail.
- Logs and internal errors in English, comments in Chinese (§7).
- If a documented endpoint stops working while you build, do **not** silently substitute another
  route: record it in `PROGRESS.local.md` and in your final report.
- Finish with a report listing: what is implemented, the exact commands you ran, their real output,
  what is not implemented, and anything you could not verify.

