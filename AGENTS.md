# AGENTS.md

Guidance for coding agents working on this repository.

## What this is

`reddit-readonly-mcp`: a TypeScript (ESM, Node ≥ 20) MCP server for Reddit that is **read-only by design**. Every
request uses an anonymous, application-only token obtained by impersonating Reddit's Android app (redlib's technique).
There is no user-token path: writes and account tools were removed on purpose, because they need either a registered
Reddit app (approval-gated since Nov 2025) or the user's account credentials, both out of scope.

## Hard rules

1. Read-only. Do not add tools or code paths that need a user identity: no posting, replying, editing, deleting,
   account data (`/api/v1/me`, saved, overview), no password grant, no credential environment variables (app id /
   secret, account username / password). Every tool is built with `readTool()` (`readOnlyHint: true`).
2. The Android client id (`REDDIT_MOBILE_CLIENT_ID`, default `ohXpoqrZYub1kg`) is used **only** for the anonymous
   read token (`mobile` and `installed` backends). Never combine it with a username/password.
3. Never log, print or return tokens, `x-reddit-loid` or `x-reddit-session`. Register new secret values with
   `registerSecret()` (src/logger.ts) as soon as they are received.
4. stdio mode: stdout carries MCP messages only. Log with the logger (stderr). `--help`/`--version` also go to stderr.
5. All agent-facing strings (tool descriptions, parameter descriptions, error messages) live in `src/messages.ts`, in
   English. Code comments are in Chinese; logs and internal error messages are in English.
6. No voting or private-messaging tools.
7. No hardcoded absolute paths.
8. If a Reddit endpoint stops working, do not silently swap in a different route; surface a clean error and document it.
   Known anonymous refusals: `/api/morechildren` → 403 (so `get_post_comments` cannot expand `more` stubs) and
   `/r/<sub>/api/link_flair_v2` → `USER_REQUIRED`.

## Code map

```
src/cli.ts, src/cli-args.ts      entry point / argument parsing
src/config.ts                    env -> Config (defaults match the README table)
src/context.ts                   process-wide AppContext shared by all MCP sessions
src/server.ts                    builds an McpServer and registers tools
src/transport/stdio.ts|http.ts   transports (HTTP: /mcp stateful sessions, /health, Host-header check)
src/auth/device.ts               Android device identity + headers (one per process)
src/auth/android-app-versions.ts data copied verbatim from redlib (do not invent entries)
src/auth/token-manager.ts        mobile -> installed -> rss cascade, 2-min refresh, rollover at remaining<=5, promise lock
src/client/reddit-client.ts      read() (anonymous, cacheable); 401 retry once, 429 rollover then backoff
src/client/rss.ts                Atom feed fallback (browse_subreddit / get_top_posts only)
src/client/shape.ts              raw Reddit JSON -> trimmed types (src/types.ts)
src/client/errors.ts             typed errors; toToolErrorText() renders agent-facing text
src/client/cache.ts              byte-bounded LRU with per-entry TTL
src/tools/define.ts              ToolDef + readTool() helper
src/tools/index.ts               registry (ALL_TOOLS, 12 tools), runTool() wraps results/errors
src/tools/read/*.ts              one file per tool; shared helpers start with "_"
src/tools/doctor.ts              diagnostics
```

## Adding a tool

1. It must work with the anonymous token (check it live first). Add its description to `TOOL_DESCRIPTIONS` (and any
   parameter text to `P`) in `src/messages.ts`.
2. Create `src/tools/read/<name>.ts` exporting `readTool(...)`. Normalise ids/names with `src/tools/helpers.ts`, shape
   output with `src/client/shape.ts`, return `{ data, after }` for listings.
3. Register it in `ALL_TOOLS` and update `EXPECTED_TOOLS` in `tests/tools.test.ts`, `EXPECTED_TOOL_COUNT` in
   `scripts/wire-check.ts`, the smoke script, plus both READMEs.

## Verification

```bash
npm run typecheck && npm test   # no network; mocked fetch
npm run build && npm run wire   # protocol check of dist/cli.js over stdio and HTTP (expects 12 tools)
npm run smoke                   # live, hits real Reddit; exercises all 12 tools, prints PASS/FAIL per call
```

Commits use conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). The only
remote is the owner's self-hosted Gitea (`origin`, `mygit:nite/reddit-readonly-mcp.git`); there is no
upstream to sync with, and the package is not published to npm. The npm package name and the
executable are both `reddit-readonly-mcp` (free on npm, checked 2026-10-16; the name `reddit-mcp` is
taken by an unrelated npm package).
