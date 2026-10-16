# AGENTS.md

Guidance for coding agents working on this repository.

## What this is

A TypeScript (ESM, Node ≥ 20) MCP server for Reddit. Reads use an anonymous token obtained by impersonating Reddit's
Android app (redlib's technique); writes use the user's own registered app + account via the password grant.

## Hard rules

1. The Android client id (`REDDIT_MOBILE_CLIENT_ID`, default `ohXpoqrZYub1kg`) is used **only** for the anonymous,
   application-only read token (`mobile` and `installed` backends). Never combine it with a username/password, never
   send Android device headers on user-token requests. `UserTokenManager.assertConfigured` refuses
   `REDDIT_CLIENT_ID === REDDIT_MOBILE_CLIENT_ID`; keep that guard and its test.
2. Never log, print or return tokens, `x-reddit-loid`, `x-reddit-session` or credentials. Register new secret values
   with `registerSecret()` (src/logger.ts) as soon as they are received.
3. stdio mode: stdout carries MCP messages only. Log with the logger (stderr). `--help`/`--version` also go to stderr.
4. All agent-facing strings (tool descriptions, parameter descriptions, error messages) live in `src/messages.ts`, in
   English. Code comments are in Chinese; logs and internal error messages are in English.
5. No voting or private-messaging tools.
6. No hardcoded absolute paths.
7. If a Reddit endpoint stops working, do not silently swap in a different route; surface a clean error and document it.

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
src/auth/user-token.ts           password grant for write/account tools
src/client/reddit-client.ts      read() (anonymous, cacheable) and user() (user token); 401 retry once, 429 backoff
src/client/rss.ts                Atom feed fallback (browse_subreddit / get_top_posts only)
src/client/shape.ts              raw Reddit JSON -> trimmed types (src/types.ts)
src/client/errors.ts             typed errors; toToolErrorText() renders agent-facing text
src/client/cache.ts              byte-bounded LRU with per-entry TTL
src/tools/define.ts              ToolDef + readTool()/writeTool() helpers
src/tools/index.ts               registry (ALL_TOOLS), runTool() wraps results/errors
src/tools/read/*.ts, write/*.ts  one file per tool; shared helpers start with "_"
src/tools/doctor.ts              diagnostics
src/write/safe-mode.ts           serialised writes, min delay, duplicate + cross-subreddit rejection, hourly cap
src/write/bot-disclosure.ts      optional footer
```

## Adding a tool

1. Add its description to `TOOL_DESCRIPTIONS` (and any parameter text to `P`) in `src/messages.ts`.
2. Create `src/tools/read/<name>.ts` or `src/tools/write/<name>.ts` exporting `readTool(...)` / `writeTool(...)`.
   Normalise ids/names with `src/tools/helpers.ts`, shape output with `src/client/shape.ts`, return
   `{ data, after }` for listings.
3. Register it in `ALL_TOOLS` and update `EXPECTED_TOOLS` in `tests/tools.test.ts` plus both READMEs.
4. Write tools must call `performWrite()` (credential check + safe mode).

## Verification

```bash
npm run typecheck && npm test   # no network; mocked fetch
npm run build && npm run wire   # protocol check of dist/cli.js over stdio and HTTP
npm run smoke                   # live, hits real Reddit; prints PASS/FAIL per call
```

Commits use conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). There is no remote;
do not publish to npm.
