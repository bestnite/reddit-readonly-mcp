import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { isTokenUrl, json, listing, rawPost, testContext, text, tokenResponse, type Call } from "./helpers.js";

const rssFixture = readFileSync(fileURLToPath(new URL("./fixtures/localllama-hot.rss", import.meta.url)), "utf8");

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
  "browse_subreddit", "doctor", "get_post_comments", "get_reddit_post", "get_subreddit_info", "get_subreddit_rules",
  "get_top_posts", "get_trending_subreddits", "get_user_comments", "get_user_info", "get_user_posts", "search_reddit",
];

describe("tool surface", () => {
  it("lists exactly the documented tools, with no voting or messaging tools", async () => {
    const { client } = await connect({}, () => json({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools.some((t) => /vote|message|pm|chat/i.test(t.name))).toBe(false);
    expect(tools.find((t) => t.name === "doctor")!.inputSchema.properties ?? {}).toEqual({});
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

  it("does not alter Reddit content that merely looks like an auth header", async () => {
    const { call } = await connect({}, api(listing([rawPost("a", { title: "Basic setup guide: Bearer tokens explained" })])));
    const r = await call("browse_subreddit", { subreddit: "LocalLLaMA" });
    expect(r.json.data[0].title).toBe("Basic setup guide: Bearer tokens explained");
  });

  it("never leaks tokens, loid or session into tool output", async () => {
    const { call } = await connect({}, (c) =>
      isTokenUrl(c.url) && c.url.includes("/auth/v2/")
        ? tokenResponse("anon-secret-token-1234")
        : text("Bearer anon-secret-token-1234 loid-value-123456", 500),
    );
    const r = await call("get_user_info", { username: "spez" });
    expect(r.isError).toBe(true);
    const d = await call("doctor");
    for (const out of [r.text, d.text]) {
      for (const secret of ["anon-secret-token-1234", "loid-value-123456", "session-value-123456"]) {
        expect(out).not.toContain(secret);
      }
    }
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
