**English** | [简体中文](README.zh-CN.md)

# reddit-readonly-mcp

An unofficial [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server designed to fetch public Reddit content reliably from datacenter and VPS IPs **without any Reddit API credentials or user accounts**.

By emulating Reddit's official Android application token exchange (based on the technique from [redlib](https://github.com/redlib-org/redlib)), `reddit-readonly-mcp` acquires anonymous application-only tokens to query `oauth.reddit.com` directly with high resilience.

---

## ✨ Features

- 🔑 **Zero Credentials Required**: No Reddit Developer app approval, API secrets, or account credentials required.
- 🌐 **VPS & Datacenter Friendly**: Bypasses the IP blocks and 403 errors common to Reddit's web endpoints on cloud IPs.
- 🛡️ **Strictly Read-Only & Privacy-First**: Queries public data exclusively; contains zero write paths or credential-handling logic.
- 🔄 **3-Tier Resilient Fallback**: Automatic cascade: `Mobile Token` → `Installed Client Token` → `RSS Fallback`.
- ⚡ **Smart Rate-Limit & Token Rollover**: Proactively rotates tokens when remaining requests drop to $\le 5$, handles 429 backoff gracefully, and caches responses via an in-memory LRU cache.
- 🔌 **Dual Transports**: Ready for both `stdio` (local MCP clients like Claude Desktop, Cursor, Hermes) and streamable `HTTP` (remote/container environments).

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) $\ge 20$

### 1. Build from Source

```bash
git clone https://github.com/.../reddit-readonly-mcp.git # or local folder
cd reddit-readonly-mcp
npm install
npm run build
```

The compiled entry point is `dist/cli.js`.

### 2. Configure Your MCP Client

#### Standard MCP Client Configuration (`stdio`)

Add this to your MCP configuration file (e.g. `claude_desktop_config.json` or Cursor `mcp.json`):

```json
{
  "mcpServers": {
    "reddit": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/reddit-readonly-mcp/dist/cli.js"]
    }
  }
}
```

#### Hermes Agent (`~/.hermes/config.yaml`)

```yaml
mcp_servers:
  reddit:
    command: "node"
    args:
      - "/ABSOLUTE/PATH/TO/reddit-readonly-mcp/dist/cli.js"
```

#### Streamable HTTP Mode

For Docker, MetaMCP, or remote gateway deployments:

```bash
node dist/cli.js --http --port 3000 --host 127.0.0.1
```

- Endpoint: `http://127.0.0.1:3000/mcp`
- Health check: `GET http://127.0.0.1:3000/health`
- *Note:* The HTTP server binds to `127.0.0.1` by default and enforces Host-header validation to prevent DNS rebinding. It has no built-in authentication; place it behind a secure proxy if exposing externally.

---

## 🛠️ Available Tools

The server provides **12 strictly read-only tools** (annotated with `readOnlyHint: true`). Output fields are sanitized and trimmed (id, title, author, subreddit, score, created timestamp, permalink, truncated selftext/body) instead of returning raw Reddit JSON dumps.

### Posts & Feeds

| Tool                      | Description                                                                                            | Key Arguments                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `browse_subreddit`        | Browse subreddit feeds sorted by `hot`, `new`, `top`, `rising`, or `controversial`. *(Works over RSS)* | `subreddit?`, `sort`, `time_filter`, `limit`, `after`                                 |
| `get_top_posts`           | Get top posts of a subreddit or the front page over a time window. *(Works over RSS)*                  | `subreddit?`, `time_filter` (`day`, `week`, `month`, `year`, `all`), `limit`, `after` |
| `get_reddit_post`         | Retrieve full details of a single post.                                                                | `id` (base36 ID, `t3_` fullname, or permalink URL)                                    |
| `get_trending_subreddits` | List currently popular subreddits (`/subreddits/popular`).                                             | `limit`, `after`                                                                      |

### Comments & Discussions

| Tool                | Description                                         | Key Arguments                                                          |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `get_post_comments` | Retrieve structured nested comment tree for a post. | `post_id`, `sort` (`confidence`, `top`, `new`, etc.), `limit`, `depth` |

> **Note on comments:** Reddit returns HTTP 403 to anonymous tokens for `/api/morechildren`. Deep collapsed reply stubs (`more`) cannot be expanded individually. To see deeper discussions, increase `limit` or `depth` in your initial request.

### Search

| Tool            | Description                                                                                                | Key Arguments                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `search_reddit` | Search Reddit posts, subreddits, or users. Supports Reddit search operators (`author:`, `flair:`, quotes). | `query` (or `q`), `subreddit?`, `sort`, `time_filter`, `type` (`link`, `sr`, `user`), `limit`, `after` |

### Community & Users

| Tool                  | Description                                                            | Key Arguments                                       |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `get_subreddit_info`  | Fetch subreddit metadata, description, subscriber count, and settings. | `subreddit`                                         |
| `get_subreddit_rules` | Fetch community rules and submission guidelines.                       | `subreddit`                                         |
| `get_user_info`       | Fetch a user's public profile, karma, and creation date.               | `username`                                          |
| `get_user_posts`      | List public posts submitted by a user.                                 | `username`, `sort`, `time_filter`, `limit`, `after` |
| `get_user_comments`   | List public comments authored by a user.                               | `username`, `sort`, `time_filter`, `limit`, `after` |

### Diagnostics

| Tool     | Description                                                                                                     | Key Arguments |
| -------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| `doctor` | Inspect active auth backend, degradation status, token expiration, remaining rate-limits, and cache statistics. | *None*        |

---

## ⚙️ Architecture & Fallback Cascade

`reddit-readonly-mcp` utilizes a multi-tiered failover pipeline to maintain high availability:

```
[Request]
   │
   ▼
1. Mobile OAuth Token ──── (5 consecutive failures) ───► 2. Installed Client Grant
   │ (Default: auth/v2/oauth/access-token/loid)                 │
   │                                                            ▼ (5 consecutive failures)
   └─────────────────────────────────────────────────────► 3. Public RSS Fallback
                                                                (browse_subreddit & get_top_posts)
```

1. **Mobile Token (`mobile`)**: Emulates Reddit's Android application handshake with random real device characteristics, acquiring a 24-hour bearer token.
2. **Installed Client Token (`installed`)**: Automatically activates if the mobile token endpoint experiences 5 consecutive failures.
3. **RSS Fallback (`rss`)**: Emergency read-only mode for feeds (`browse_subreddit` and `get_top_posts`) if OAuth endpoints are unreachable.
4. **Auto-Recovery**: The server checks primary backends every 30 minutes and automatically restores higher-tier access once available.

### Token & Rate-Limit Management

- **Proactive Token Refresh**: Automatically renews the OAuth token 2 minutes prior to expiration.
- **Quota Rollover**: Monitors `x-ratelimit-remaining`; rolls over to a clean token window when remaining requests drop to $\le 5$.
- **Backoff & Retries**: Handles HTTP 429 by triggering token rollover followed by exponential retry respecting `Retry-After`.
- **In-Memory Cache**: Bounded LRU cache reduces redundant upstream calls.

---

## 🔧 Environment Variables

All configuration is optional. No credential variables (client secret, password, etc.) exist or are accepted.

| Variable                  | Default          | Description                                                                |
| ------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `REDDIT_AUTH_MODE`        | `auto`           | Backend mode: `auto` (cascade enabled), `mobile`, `installed`, or `rss`.   |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android client ID override point if upstream revokes the default constant. |
| `REDDIT_CACHE`            | `on`             | In-memory read cache (`on` / `off`).                                       |
| `REDDIT_CACHE_MAX_MB`     | `50`             | Maximum memory limit for LRU cache in megabytes.                           |
| `REDDIT_MAX_RETRIES`      | `3`              | Maximum retry attempts upon encountering HTTP 429 rate limits.             |
| `REDDIT_TIMEOUT_MS`       | `20000`          | HTTP request timeout in milliseconds.                                      |
| `REDDIT_LOG_LEVEL`        | `info`           | Logging verbosity to stderr: `debug`, `info`, `warn`, `error`, `silent`.   |

---

## 📋 Scope & Design Boundaries

- **Read-Only by Design**: Write actions (submitting posts, comments, voting, private messages) are intentionally excluded. They require user-specific OAuth scopes and accounts, which are out of scope.
- **Public Data Only**: Private subreddits, banned users, and authenticated user endpoints (e.g. saved items, inbox) are not accessible.
- **No Expansion of Deep Comment Stubs**: Reddit's `/api/morechildren` endpoint returns 403 for anonymous tokens. Adjust `limit` and `depth` in `get_post_comments` instead.

---

## 🧪 Development & Testing

```bash
# Build TypeScript to dist/
npm run build

# Type check
npm run typecheck

# Unit tests (mocked, offline)
npm test

# Protocol wire verification (stdio & HTTP check)
npm run wire

# Live integration test against real Reddit endpoints
npm run smoke
```

---

## 📄 License

[MIT](LICENSE). Device metadata in `src/auth/android-app-versions.ts` is sourced from [redlib](https://github.com/redlib-org/redlib) (MIT).
