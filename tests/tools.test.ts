import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { DEFAULT_BOT_FOOTER } from "../src/write/bot-disclosure.js";
import { isTokenUrl, json, listing, rawPost, testContext, text, tokenResponse, type Call } from "./helpers.js";

const rssFixture = readFileSync(fileURLToPath(new URL("./fixtures/localllama-hot.rss", import.meta.url)), "utf8");
const WRITE_ENV = {
  REDDIT_CLIENT_ID: "myAppId123",
  REDDIT_CLIENT_SECRET: "myAppSecret456",
  REDDIT_USERNAME: "botuser",
  REDDIT_PASSWORD: "hunter2-password",
};

async function connect(env: Record<string, string>, handler: (c: Call) => Response | Promise<Response>) {
  const { ctx, calls } = testContext(env, handler);
  const server = buildServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const t = (res.content as Array<{ text: string }>)[0]!.text;
    let parsed: any = null;
    try {
      parsed = JSON.parse(t);
    } catch {}
    return { isError: res.isError === true, text: t, json: parsed };
  };
  return { client, call, calls, ctx };
}

const EXPECTED_TOOLS = [
  "browse_subreddit", "create_post", "delete_comment", "delete_post", "doctor", "edit_comment", "edit_post",
  "get_me", "get_more_comments", "get_my_overview", "get_my_saved", "get_post_comments", "get_post_flairs",
  "get_reddit_post", "get_subreddit_info", "get_subreddit_rules", "get_top_posts", "get_trending_subreddits",
  "get_user_comments", "get_user_info", "get_user_posts", "reply_to_post", "search_reddit",
];

describe("tool surface", () => {
  it("lists exactly the documented tools, with no voting or messaging tools", async () => {
    const { client } = await connect({}, () => json({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools.some((t) => /vote|message|pm|chat/i.test(t.name))).toBe(false);
    for (const name of ["delete_post", "delete_comment"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.description).toMatch(/PERMANENTLY/);
      expect(t.annotations?.destructiveHint).toBe(true);
    }
    expect(tools.find((t) => t.name === "doctor")!.inputSchema.properties ?? {}).toEqual({});
  });
});

describe("write tools without credentials", () => {
  for (const [tool, args] of [
    ["create_post", { subreddit: "test", title: "t", content: "c" }],
    ["reply_to_post", { post_id: "t3_abc", content: "hi" }],
    ["edit_post", { thing_id: "t3_abc", new_text: "x" }],
    ["edit_comment", { thing_id: "t1_abc", new_text: "x" }],
    ["delete_post", { thing_id: "t3_abc" }],
    ["delete_comment", { thing_id: "t1_abc" }],
    ["get_me", {}],
    ["get_my_overview", {}],
    ["get_my_saved", {}],
  ] as const) {
    it(`${tool} fails clearly naming the missing vars and makes no request`, async () => {
      const { call, calls } = await connect({}, () => json({}));
      const r = await call(tool, args);
      expect(r.isError).toBe(true);
      expect(r.text).toContain("REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD");
      expect(r.text).toContain("registered Reddit app");
      expect(r.text).toContain("read-only by design");
      expect(calls).toHaveLength(0);
    });
  }

  it("lists only the vars that are actually missing", async () => {
    const { call } = await connect({ REDDIT_CLIENT_ID: "abc123", REDDIT_USERNAME: "me" }, () => json({}));
    const r = await call("delete_post", { thing_id: "abc" });
    expect(r.text).toContain("missing REDDIT_CLIENT_SECRET, REDDIT_PASSWORD.");
  });
});

describe("write tools with credentials", () => {
  const handler = (c: Call) => {
    if (c.url === "https://www.reddit.com/api/v1/access_token") return json({ access_token: "user-token-YYYYYYYY", expires_in: 3600 });
    if (c.url.startsWith("https://oauth.reddit.com/api/submit"))
      return json({ json: { errors: [], data: { id: "new1", name: "t3_new1", url: "https://www.reddit.com/r/test/comments/new1/t/" } } });
    return json({ json: { errors: [], data: { things: [{ kind: "t1", data: { id: "c9", name: "t1_c9", body: "hi", parent_id: "t3_abc" } }] } } });
  };

  it("create_post submits a self post with bot disclosure and blocks cross-subreddit duplicates", async () => {
    const { call, calls } = await connect({ ...WRITE_ENV, REDDIT_BOT_DISCLOSURE: "auto", REDDIT_SAFE_MODE: "standard" }, handler);
    const r1 = await call("create_post", { subreddit: "r/test", title: "Hello", content: "Body text", flair_id: "f1" });
    expect(r1.isError).toBe(false);
    expect(r1.json).toMatchObject({ ok: true, id: "new1", fullname: "t3_new1", subreddit: "test", bot_disclosure_appended: true });
    const submit = calls.find((c) => c.url.startsWith("https://oauth.reddit.com/api/submit"))!;
    const form = new URLSearchParams(submit.body);
    expect(form.get("sr")).toBe("test");
    expect(form.get("kind")).toBe("self");
    expect(form.get("text")).toBe(`Body text${DEFAULT_BOT_FOOTER}`);
    expect(form.get("flair_id")).toBe("f1");
    expect(submit.headers.authorization).toBe("Bearer user-token-YYYYYYYY");

    const r2 = await call("create_post", { subreddit: "other", title: "Hello again", content: "body   TEXT" });
    expect(r2.isError).toBe(true);
    expect(r2.text).toContain("r/test");
    expect(calls.filter((c) => c.url.startsWith("https://oauth.reddit.com/api/submit"))).toHaveLength(1);
  });

  it("reply_to_post accepts a comment parent and returns the trimmed comment", async () => {
    const { call, calls } = await connect({ ...WRITE_ENV, REDDIT_SAFE_MODE: "off" }, handler);
    const r = await call("reply_to_post", { post_id: "t1_parent", content: "hi" });
    expect(r.isError).toBe(false);
    expect(r.json.comment).toMatchObject({ id: "c9", fullname: "t1_c9" });
    const req = calls.find((c) => c.url.startsWith("https://oauth.reddit.com/api/comment"))!;
    expect(new URLSearchParams(req.body).get("thing_id")).toBe("t1_parent");
    expect(new URLSearchParams(req.body).get("text")).toBe("hi");
  });

  it("delete_post posts the fullname to /api/del", async () => {
    const { call, calls } = await connect({ ...WRITE_ENV, REDDIT_SAFE_MODE: "off" }, (c) =>
      isTokenUrl(c.url) ? json({ access_token: "user-token-YYYYYYYY", expires_in: 3600 }) : json({}),
    );
    const r = await call("delete_post", { thing_id: "abc12" });
    expect(r.json).toEqual({ ok: true, deleted: "t3_abc12", permanent: true });
    expect(new URLSearchParams(calls[1]!.body).get("id")).toBe("t3_abc12");
  });
});

describe("read tools", () => {
  const api = (body: unknown) => (c: Call) => (isTokenUrl(c.url) ? tokenResponse() : json(body));

  it("browse_subreddit returns trimmed {data, after}", async () => {
    const { call, calls } = await connect({}, api(listing([rawPost("a"), rawPost("b")], "t3_b")));
    const r = await call("browse_subreddit", { subreddit: "LocalLLaMA", sort: "top", time_filter: "day", limit: 2, after: "t3_x" });
    expect(r.isError).toBe(false);
    expect(r.json.after).toBe("t3_b");
    expect(r.json.data.map((p: any) => p.id)).toEqual(["a", "b"]);
    expect(r.text).not.toContain("media_metadata");
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe("/r/LocalLLaMA/top");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ t: "day", limit: "2", after: "t3_x" });
  });

  it("search_reddit accepts 'q' as an alias and restricts to the subreddit", async () => {
    const { call, calls } = await connect({}, api(listing([rawPost("a")])));
    const r = await call("search_reddit", { q: "hermes", subreddit: "LocalLLaMA", limit: 3 });
    expect(r.isError).toBe(false);
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe("/r/LocalLLaMA/search");
    expect(u.searchParams.get("q")).toBe("hermes");
    expect(u.searchParams.get("restrict_sr")).toBe("1");
    const empty = await call("search_reddit", {});
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain("'query'");
  });

  it("get_more_comments returns a clean error when Reddit refuses anonymous access", async () => {
    const { call } = await connect({}, (c) => (isTokenUrl(c.url) ? tokenResponse() : text("<body>blocked</body>", 403)));
    const r = await call("get_more_comments", { link_id: "t3_abc", comment_ids: ["c1", "t1_c2"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("anonymous access (HTTP 403)");
    expect(r.text).toContain("REDDIT_CLIENT_ID");
  });

  it("get_post_flairs maps USER_REQUIRED to a clean error", async () => {
    const { call } = await connect({}, api({ json: { errors: [["USER_REQUIRED", "Please log in to do that.", null]] } }));
    const r = await call("get_post_flairs", { subreddit_name: "LocalLLaMA" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("logged-in user");
  });

  it("never leaks tokens or credentials into tool output", async () => {
    const { call } = await connect(WRITE_ENV, (c) =>
      isTokenUrl(c.url) && c.url.includes("/auth/v2/")
        ? tokenResponse("anon-secret-token-1234")
        : text("Bearer anon-secret-token-1234 hunter2-password loid-value-123456", 500),
    );
    const r = await call("get_user_info", { username: "spez" });
    expect(r.isError).toBe(true);
    const d = await call("doctor");
    for (const out of [r.text, d.text]) {
      for (const secret of ["anon-secret-token-1234", "hunter2-password", "myAppSecret456", "loid-value-123456", "session-value-123456"]) {
        expect(out).not.toContain(secret);
      }
    }
    expect(d.json.write.env).toEqual({ REDDIT_CLIENT_ID: true, REDDIT_CLIENT_SECRET: true, REDDIT_USERNAME: true, REDDIT_PASSWORD: true });
    expect(d.json.write.ready).toBe(true);
  });
});

describe("mobile -> installed -> rss cascade through the tools", () => {
  it("degrades to RSS, keeps browse_subreddit working and errors clearly elsewhere", async () => {
    const { call, calls } = await connect({}, (c) => {
      if (isTokenUrl(c.url)) return text("<html>blocked</html>", 403);
      if (c.url === "https://www.reddit.com/r/LocalLLaMA/hot.rss") return text(rssFixture, 200, { "content-type": "application/atom+xml" });
      return text("unexpected", 500);
    });
    const r = await call("browse_subreddit", { subreddit: "LocalLLaMA", limit: 5 });
    expect(r.isError).toBe(false);
    expect(r.json.source).toBe("rss");
    expect(r.json.after).toBeNull();
    expect(r.json.data).toHaveLength(2);
    expect(r.json.data[0].score).toBeNull();
    expect(calls.filter((c) => c.url.includes("/auth/v2/"))).toHaveLength(5);
    expect(calls.filter((c) => c.url.includes("/api/v1/access_token"))).toHaveLength(5);

    const s = await call("search_reddit", { query: "x" });
    expect(s.isError).toBe(true);
    expect(s.text).toContain("search_reddit is unavailable");
    expect(s.text).toContain("RSS");

    const page2 = await call("browse_subreddit", { subreddit: "LocalLLaMA", after: "t3_x" });
    expect(page2.isError).toBe(true);
    expect(page2.text).toContain("Pagination");

    const d = await call("doctor");
    expect(d.json.read_backend).toMatchObject({ active_backend: "rss", degraded: true });
  });

  it("reports an actionable error when every backend fails", async () => {
    const { call } = await connect({}, (c) => (c.url.endsWith(".rss") ? text("", 429, { "retry-after": "999" }) : text("no", 403)));
    const r = await call("get_top_posts", { subreddit: "LocalLLaMA" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Could not reach Reddit through any backend");
    expect(r.text).toContain("REDDIT_MOBILE_CLIENT_ID");
  });
});
