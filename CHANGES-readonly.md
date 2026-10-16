# CHANGE REQUEST — make the server read-only

This project (`~/mcp/reddit-mcp`) was just built from `SPEC.md`. The owner has decided that **write
operations will never be possible in this project's design** (they require a user identity: either a
registered Reddit app — approval-gated since Nov 2025 — or handing the user's account credentials to
the tool, which is explicitly out of scope). Therefore: **remove every tool and every code path that
requires a user identity. The server becomes strictly read-only.**

Implement this now, verify it, commit it, and update the audit trail. Do not ask questions; nobody
can answer in this mode.

## 1. Tools to DELETE

Write tier (all six, plus their shared helpers):

- `src/tools/write/create-post.ts`, `delete-post.ts`, `edit-post.ts`, `edit-comment.ts`,
  `reply-to-post.ts`, and the shared `src/tools/write/_write.ts`, `src/tools/write/_edit.ts`

Account-only read tools (they can never work without a user token):

- `src/tools/read/get-me.ts`, `get-my-overview.ts`, `get-my-saved.ts`
- `src/tools/read/get-post-flairs.ts` (anonymous call returns `USER_REQUIRED`)
- `src/tools/read/get-more-comments.ts` (`/api/morechildren` returns HTTP 403 for anonymous tokens —
  measured; do not replace it with another route)

Supporting modules to DELETE entirely:

- `src/auth/user-token.ts` (the password-grant user token)
- `src/write/safe-mode.ts`, `src/write/bot-disclosure.ts` (and the `src/write/` directory)

Their tests: delete or trim the test files/`describe` blocks that cover write tools, safe mode, bot
disclosure, the user token, and the five account-only tools. Keep every other test.

## 2. Tools to KEEP — exactly these twelve

`browse_subreddit`, `get_top_posts`, `get_reddit_post`, `search_reddit`, `get_post_comments`,
`get_user_info`, `get_user_posts`, `get_user_comments`, `get_subreddit_info`,
`get_subreddit_rules`, `get_trending_subreddits`, `doctor`.

`get_post_comments` keeps working as-is, but its description must state that `more` stubs in the
response cannot be expanded by this server (Reddit answers `/api/morechildren` with 403 for
anonymous tokens), so the caller should not expect a follow-up call to retrieve them.

## 3. Configuration to REMOVE

Delete these env vars from the loader, the config type, the README tables and anywhere else they
appear: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`,
`REDDIT_SAFE_MODE`, `REDDIT_BOT_DISCLOSURE`, `REDDIT_BOT_FOOTER`.

Keep: `REDDIT_AUTH_MODE`, `REDDIT_MOBILE_CLIENT_ID`, `REDDIT_CACHE`, `REDDIT_CACHE_MAX_MB`,
`REDDIT_MAX_RETRIES`, `REDDIT_TIMEOUT_MS`.

Also remove:

- the "missing write vars" / "write readiness" logic and messages, and the credential-registration
  of the account password/secret in the logger;
- the `write tools: not configured` / write-ready fields from the startup log line and from the
  `doctor` output (keep backend, degraded flag, token expiry, rate-limit remaining/reset, cache
  stats);
- the `MobileIdForUserGrant` guard and its message — with the user-token path gone there is no code
  left that could combine the Android client id with credentials, so the guard is dead weight. Say
  so in the commit message.

## 4. Docs

- `README.md` / `README.zh-CN.md`: rewrite the tool list to the twelve tools, drop the write /
  safe-mode / bot-disclosure / credential sections and the write rows from the config table, and
  make the "Risks" section state plainly: **this server is read-only by design.** Writes were
  deliberately removed because posting/replying/voting need a user-context token, which would mean
  either a registered Reddit app (self-service creation closed Nov 2025; approval required) or
  handing Reddit account credentials to the tool. Keep the language-switch line at the top of both
  files and keep them in sync.
- `AGENTS.md`: update anything that describes the write tier.
- Keep the existing note that the npm package name is `reddit-mobile-mcp` and the executable is
  `reddit-mcp`.

## 5. Verification you must actually run and paste

1. `npm run build` and `npm run typecheck` — both clean.
2. `npm test` — all remaining tests pass (report the new count).
3. `npm run smoke` — live, against real Reddit; update the script so it covers only the kept tools,
   and confirm `SMOKE: ALL PASS`.
4. `npm run wire` — update the expected tool count to **12**; confirm `WIRE: ALL PASS` on both
   transports.
5. Prove the removal is real, not just unregistered: start the server over stdio, send
   `tools/list`, and show that none of the deleted tool names appear; then call one deleted name
   (e.g. `create_post`) and show the protocol-level "unknown tool" error. Paste that output.

## 6. Housekeeping

- Commit in small conventional commits (`refactor:`, `docs:`, `test:`, `chore:`); use
  `git -c commit.gpgsign=false` (no signing key is configured here).
- Append a new section to `PROGRESS.local.md` recording this change: what was removed, the new tool
  count, the commit ids, and anything you could not verify.
- Finish with a report: what changed, the exact commands you ran, their real output, and anything
  still unverified.
