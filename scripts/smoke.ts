// 实网冒烟测试：通过内存 MCP 传输调用真实工具，访问真实 Reddit。
// 每个调用打印一行 PASS/FAIL，任何 FAIL 时以非零退出码结束。
// 用法：npm run smoke

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { createLogger } from "../src/logger.js";
import { buildServer } from "../src/server.js";

type Json = any;

let failures = 0;

async function connect(env: Record<string, string | undefined>): Promise<Client> {
  const { config } = loadConfig(env);
  const ctx = createContext(config, { logger: createLogger("warn") });
  const server = buildServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "reddit-mcp-smoke", version: "0.0.0" });
  await client.connect(b);
  return client;
}

async function call(
  client: Client,
  label: string,
  name: string,
  args: Record<string, unknown>,
  check: (r: Json, isError: boolean, text: string) => string,
): Promise<Json> {
  const started = Date.now();
  let json: Json = null;
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const isError = res.isError === true;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const summary = check(json, isError, text);
    console.log(`PASS  ${label}  (${Date.now() - started} ms)  ${summary}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${label}  (${Date.now() - started} ms)  ${err instanceof Error ? err.message : String(err)}`);
  }
  return json;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function ok(isError: boolean, text: string): void {
  assert(!isError, `tool error: ${text.slice(0, 300)}`);
}

async function main(): Promise<void> {
  // 冒烟测试只验证匿名读路径，不带任何写凭据
  const baseEnv: Record<string, string | undefined> = {
    ...process.env,
    REDDIT_CLIENT_ID: undefined,
    REDDIT_CLIENT_SECRET: undefined,
    REDDIT_USERNAME: undefined,
    REDDIT_PASSWORD: undefined,
  };
  const api = await connect({ ...baseEnv, REDDIT_AUTH_MODE: process.env.REDDIT_AUTH_MODE ?? "auto" });

  await call(api, "doctor", "doctor", {}, (r, isError, text) => {
    ok(isError, text);
    const rb = r.read_backend;
    assert(rb.token_check.ok, `token check failed: ${rb.token_check.error}`);
    assert(rb.active_backend === "mobile" || rb.active_backend === "installed", `backend is ${rb.active_backend}`);
    return `backend=${rb.active_backend} degraded=${rb.degraded} token_expires_in_s=${rb.token?.expires_in_s} write_ready=${r.write.ready}`;
  });

  const browse = await call(
    api,
    "browse_subreddit r/LocalLLaMA --sort hot --limit 3",
    "browse_subreddit",
    { subreddit: "LocalLLaMA", sort: "hot", limit: 3 },
    (r, isError, text) => {
      ok(isError, text);
      assert(Array.isArray(r.data) && r.data.length >= 1 && r.data.length <= 3, `got ${r.data?.length} posts`);
      for (const p of r.data) {
        assert(p.id && p.fullname?.startsWith("t3_") && p.title, "post missing id/fullname/title");
        assert(typeof p.score === "number" && typeof p.num_comments === "number", "post missing score/num_comments");
        assert(/^\d{4}-\d\d-\d\dT/.test(p.created_utc), "created_utc not ISO");
      }
      return `${r.data.length} posts, after=${r.after}, first="${String(r.data[0].title).slice(0, 60)}"`;
    },
  );

  await call(
    api,
    'search_reddit "hermes" --subreddit LocalLLaMA --limit 3',
    "search_reddit",
    { query: "hermes", subreddit: "LocalLLaMA", limit: 3 },
    (r, isError, text) => {
      ok(isError, text);
      assert(Array.isArray(r.data) && r.data.length >= 1, "no search results");
      assert(
        r.data.every((p: Json) => p.subreddit.toLowerCase() === "localllama"),
        "result outside r/LocalLLaMA",
      );
      return `${r.data.length} results, first="${String(r.data[0].title).slice(0, 60)}"`;
    },
  );

  // 选一个有评论的真实帖子
  const posts: Json[] = browse?.data ?? [];
  const target = posts.find((p) => p.num_comments > 0 && !p.stickied) ?? posts[0];
  if (target) {
    await call(
      api,
      `get_post_comments ${target.id} --limit 20 --depth 2`,
      "get_post_comments",
      { post_id: target.id, limit: 20, depth: 2 },
      (r, isError, text) => {
        ok(isError, text);
        assert(r.post?.id === target.id, "post id mismatch");
        assert(Array.isArray(r.data), "comments not an array");
        return `post="${String(r.post.title).slice(0, 40)}" top-level=${r.data.length} total=${r.comment_count_returned} more_stubs=${r.more.length}`;
      },
    );
  } else {
    failures++;
    console.log("FAIL  get_post_comments  no post available from browse_subreddit");
  }

  await call(api, "get_user_info spez", "get_user_info", { username: "spez" }, (r, isError, text) => {
    ok(isError, text);
    assert(r.name?.toLowerCase() === "spez", `name=${r.name}`);
    assert(typeof r.total_karma === "number", "no karma");
    return `name=${r.name} created=${r.created_utc} total_karma=${r.total_karma} is_employee=${r.is_employee}`;
  });

  await call(
    api,
    "get_subreddit_rules LocalLLaMA",
    "get_subreddit_rules",
    { subreddit_name: "LocalLLaMA" },
    (r, isError, text) => {
      ok(isError, text);
      assert(Array.isArray(r.data) && r.data.length >= 1, "no rules");
      return `${r.data.length} rules, first="${r.data[0].short_name}"`;
    },
  );

  await call(api, "doctor (after calls)", "doctor", {}, (r, isError, text) => {
    ok(isError, text);
    const rl = r.read_backend.rate_limit;
    assert(rl.remaining !== null, "rate limit not tracked");
    return `x-ratelimit-remaining=${rl.remaining} used=${rl.used} reset_in_s=${rl.reset_in_s} cache_hits=${r.cache.hits}`;
  });

  // RSS 回退模式
  const rss = await connect({ ...baseEnv, REDDIT_AUTH_MODE: "rss" });
  await call(
    rss,
    "[REDDIT_AUTH_MODE=rss] browse_subreddit r/LocalLLaMA --sort hot --limit 3",
    "browse_subreddit",
    { subreddit: "LocalLLaMA", sort: "hot", limit: 3 },
    (r, isError, text) => {
      ok(isError, text);
      assert(r.source === "rss", `source=${r.source}`);
      assert(Array.isArray(r.data) && r.data.length >= 1 && r.data.length <= 3, `got ${r.data?.length}`);
      assert(r.data[0].fullname.startsWith("t3_") && r.data[0].title, "bad rss entry");
      assert(r.data[0].score === null && r.after === null, "rss should have no score/pagination");
      return `${r.data.length} posts via RSS, first="${String(r.data[0].title).slice(0, 60)}"`;
    },
  );
  await call(
    rss,
    "[REDDIT_AUTH_MODE=rss] search_reddit returns a clean 'unsupported on RSS' error",
    "search_reddit",
    { query: "hermes" },
    (_r, isError, text) => {
      assert(isError, "expected an error");
      assert(text.includes("search_reddit") && text.includes("RSS"), `unexpected text: ${text}`);
      return `error="${text.slice(0, 90)}…"`;
    },
  );

  console.log(failures === 0 ? "\nSMOKE: ALL PASS" : `\nSMOKE: ${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log(`FAIL  smoke harness crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
