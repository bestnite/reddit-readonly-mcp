import { describe, expect, it } from "vitest";
import { HttpError, RateLimitError, RedditApiError, RedirectError } from "../src/client/errors.js";
import { retryAfterMs } from "../src/client/reddit-client.js";
import { FIXED_UUID, isTokenUrl, json, listing, rawPost, testContext, text, tokenResponse } from "./helpers.js";

const WRITE_ENV = {
  REDDIT_CLIENT_ID: "myAppId123",
  REDDIT_CLIENT_SECRET: "myAppSecret456",
  REDDIT_USERNAME: "botuser",
  REDDIT_PASSWORD: "hunter2-password",
};

describe("anonymous read requests", () => {
  it("sends Android headers, bearer token, loid/session and raw_json=1 to oauth.reddit.com", async () => {
    const { ctx, calls } = testContext({}, (c) =>
      isTokenUrl(c.url) ? tokenResponse() : json(listing([rawPost("abc")]), 200, { "x-ratelimit-remaining": "98.0", "x-ratelimit-used": "2", "x-ratelimit-reset": "400" }),
    );
    await ctx.client.read("/r/LocalLLaMA/hot", { limit: 3, after: undefined }, { what: "r/LocalLLaMA" });
    const api = calls[1]!;
    const url = new URL(api.url);
    expect(url.origin).toBe("https://oauth.reddit.com");
    expect(url.pathname).toBe("/r/LocalLLaMA/hot");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.get("raw_json")).toBe("1");
    expect(url.searchParams.has("after")).toBe(false);
    expect(api.headers.authorization).toBe("Bearer anon-token-AAAAAAAAAAAA");
    expect(api.headers["x-reddit-loid"]).toBe("loid-value-123456");
    expect(api.headers["x-reddit-session"]).toBe("session-value-123456");
    expect(api.headers["client-vendor-id"]).toBe(FIXED_UUID);
    expect(api.headers["x-reddit-device-id"]).toBe(FIXED_UUID);
    expect(api.headers["user-agent"]).toMatch(/^Reddit\/Version /);
    expect(ctx.tokens.status().rate_limit).toMatchObject({ remaining: 98, used: 2, reset_in_s: 400 });
  });

  it("rolls the token over before the next request when the rate limit runs low", async () => {
    let tokens = 0;
    const { ctx, calls } = testContext({}, (c) =>
      isTokenUrl(c.url) ? tokenResponse(`tok-${++tokens}-xxxxxxxx`) : json(listing([]), 200, { "x-ratelimit-remaining": "4.0" }),
    );
    await ctx.client.read("/r/a/hot", {}, { what: "a" });
    await ctx.client.read("/r/b/hot", {}, { what: "b" });
    expect(tokens).toBe(2);
    expect(calls.filter((c) => !isTokenUrl(c.url)).map((c) => c.headers.authorization)).toEqual([
      "Bearer tok-1-xxxxxxxx",
      "Bearer tok-2-xxxxxxxx",
    ]);
    expect(ctx.tokens.status().rate_limit.rollovers).toBe(1);
  });

  it("on 401 refreshes the token once and retries once", async () => {
    let tokens = 0;
    let api = 0;
    const { ctx } = testContext({}, (c) => {
      if (isTokenUrl(c.url)) return tokenResponse(`tok-${++tokens}-xxxxxxxx`);
      return ++api === 1 ? json({ message: "Unauthorized", error: 401 }, 401) : json(listing([rawPost("x")]));
    });
    const res = await ctx.client.read<any>("/r/a/hot", {}, { what: "a" });
    expect(res.data.children).toHaveLength(1);
    expect(tokens).toBe(2);
    expect(api).toBe(2);
  });

  it("gives up after a second 401", async () => {
    const { ctx, calls } = testContext({}, (c) => (isTokenUrl(c.url) ? tokenResponse() : json({ error: 401 }, 401)));
    const err = await ctx.client.read("/r/a/hot", {}, { what: "r/a" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect(calls.filter((c) => !isTokenUrl(c.url))).toHaveLength(2);
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    let api = 0;
    const { ctx } = testContext({}, (c) => {
      if (isTokenUrl(c.url)) return tokenResponse();
      return ++api < 3 ? text("slow down", 429, { "retry-after": "2" }) : json(listing([]));
    });
    (ctx.client as any).sleep = async (ms: number) => void sleeps.push(ms);
    await ctx.client.read("/r/a/hot", {}, { what: "a" });
    expect(sleeps).toEqual([2000, 2000]);
    expect(ctx.client.requestStats().retries429).toBe(2);
  });

  it("raises RateLimitError once REDDIT_MAX_RETRIES is exhausted", async () => {
    const { ctx, calls } = testContext({ REDDIT_MAX_RETRIES: "1" }, (c) =>
      isTokenUrl(c.url) ? tokenResponse() : text("", 429, { "retry-after": "1" }),
    );
    const err = await ctx.client.read("/r/a/hot", {}, { what: "a" }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(calls.filter((c) => !isTokenUrl(c.url))).toHaveLength(2);
  });

  it("serves repeated reads from the cache and respects REDDIT_CACHE=off", async () => {
    const on = testContext({}, (c) => (isTokenUrl(c.url) ? tokenResponse() : json(listing([]))));
    await on.ctx.client.read("/r/a/hot", { limit: 1 }, { what: "a", cacheTtlMs: 60_000 });
    await on.ctx.client.read("/r/a/hot", { limit: 1 }, { what: "a", cacheTtlMs: 60_000 });
    expect(on.calls.filter((c) => !isTokenUrl(c.url))).toHaveLength(1);
    expect(on.ctx.cache.stats().hits).toBe(1);

    const off = testContext({ REDDIT_CACHE: "off" }, (c) => (isTokenUrl(c.url) ? tokenResponse() : json(listing([]))));
    await off.ctx.client.read("/r/a/hot", { limit: 1 }, { what: "a", cacheTtlMs: 60_000 });
    await off.ctx.client.read("/r/a/hot", { limit: 1 }, { what: "a", cacheTtlMs: 60_000 });
    expect(off.calls.filter((c) => !isTokenUrl(c.url))).toHaveLength(2);
  });

  it("maps HTML block pages, Reddit API errors and redirects to typed errors", async () => {
    const { ctx } = testContext({}, (c) => {
      if (isTokenUrl(c.url)) return tokenResponse();
      if (c.url.includes("/blocked")) return text("<html>whoa there</html>", 403);
      if (c.url.includes("/flair")) return json({ json: { errors: [["USER_REQUIRED", "Please log in to do that.", null]] } });
      return text("", 302, { location: "https://www.reddit.com/subreddits/search?q=x" });
    });
    const blocked = await ctx.client.read("/blocked", {}, { what: "x" }).catch((e) => e);
    expect(blocked).toBeInstanceOf(HttpError);
    expect((blocked as HttpError).nonJson).toBe(true);
    const api = await ctx.client.read("/flair", {}, { what: "flairs" }).catch((e) => e);
    expect(api).toBeInstanceOf(RedditApiError);
    expect((api as RedditApiError).toolText()).toContain("logged-in user");
    const redir = await ctx.client.read("/r/doesnotexist/hot", {}, { what: "r/doesnotexist" }).catch((e) => e);
    expect(redir).toBeInstanceOf(RedirectError);
  });
});

describe("user-token requests (write path)", () => {
  it("uses the registered app + password grant and never the Android identity", async () => {
    const { ctx, calls } = testContext(WRITE_ENV, (c) =>
      c.url === "https://www.reddit.com/api/v1/access_token"
        ? json({ access_token: "user-token-YYYYYYYY", expires_in: 3600 })
        : json({ json: { errors: [], data: { things: [] } } }),
    );
    await ctx.client.user("/api/comment", { what: "reply", tool: "reply_to_post", method: "POST", form: { thing_id: "t3_abc", text: "hi" } });

    const tok = calls[0]!;
    expect(tok.method).toBe("POST");
    expect(tok.headers.authorization).toBe(`Basic ${Buffer.from("myAppId123:myAppSecret456").toString("base64")}`);
    expect(new URLSearchParams(tok.body).get("grant_type")).toBe("password");
    expect(new URLSearchParams(tok.body).get("username")).toBe("botuser");
    expect(tok.headers["user-agent"]).toBe("node:reddit-mcp:0.1.0 (by /u/botuser)");

    const write = calls[1]!;
    expect(write.url).toBe("https://oauth.reddit.com/api/comment?raw_json=1");
    expect(write.headers.authorization).toBe("Bearer user-token-YYYYYYYY");
    expect(new URLSearchParams(write.body).get("api_type")).toBe("json");
    expect(new URLSearchParams(write.body).get("thing_id")).toBe("t3_abc");

    for (const c of calls) {
      expect(c.url).not.toContain("/auth/v2/oauth/access-token/loid");
      expect(c.headers.authorization).not.toBe("Basic b2hYcG9xclpZdWIxa2c6");
      expect(c.headers["user-agent"]).not.toMatch(/^Reddit\//);
      expect(c.headers["client-vendor-id"]).toBeUndefined();
      expect(c.headers["x-reddit-device-id"]).toBeUndefined();
      expect(c.headers["x-reddit-loid"]).toBeUndefined();
    }
  });

  it("refuses to use the Android client id with account credentials", async () => {
    const { ctx, calls } = testContext({ ...WRITE_ENV, REDDIT_CLIENT_ID: "ohXpoqrZYub1kg" }, () => json({}));
    const err: any = await ctx.client.user("/api/v1/me", { what: "me", tool: "get_me" }).catch((e) => e);
    expect(String(err.message)).toContain("Refusing");
    expect(calls).toHaveLength(0);
  });
});

describe("retryAfterMs", () => {
  it("prefers Retry-After, then x-ratelimit-reset, then exponential backoff", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "3" }), 0)).toBe(3000);
    expect(retryAfterMs(new Headers({ "x-ratelimit-reset": "7" }), 0)).toBe(7000);
    expect(retryAfterMs(new Headers(), 0)).toBe(1000);
    expect(retryAfterMs(new Headers(), 2)).toBe(4000);
  });
});
