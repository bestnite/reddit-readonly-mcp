import { describe, expect, it } from "vitest";
import { TokenManager, type TokenManagerOptions } from "../src/auth/token-manager.js";
import { AuthBackendError, NetworkError } from "../src/client/errors.js";
import { clock, FIXED_UUID, fixedDevice, json, mockFetch, text, tokenResponse, type Call } from "./helpers.js";

const MOBILE_URL = "https://www.reddit.com/auth/v2/oauth/access-token/loid";
const INSTALLED_URL = "https://www.reddit.com/api/v1/access_token";
// base64("ohXpoqrZYub1kg:")
const BASIC = "Basic b2hYcG9xclpZdWIxa2c6";

function manager(handler: (c: Call) => Response | Promise<Response>, extra: Partial<TokenManagerOptions> = {}) {
  const { fetch, calls } = mockFetch(handler);
  const c = clock();
  const tm = new TokenManager({
    mode: "auto",
    mobileClientId: "ohXpoqrZYub1kg",
    device: fixedDevice(),
    fetch,
    now: c.now,
    sleep: async () => {},
    retryBackoffMs: 0,
    ...extra,
  });
  return { tm, calls, clock: c };
}

describe("mobile token request construction", () => {
  it("sends exactly the redlib loid request", async () => {
    const { tm, calls } = manager(() => tokenResponse());
    const auth = await tm.getReadAuth();

    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url).toBe(MOBILE_URL);
    expect(c.headers.authorization).toBe(BASIC);
    expect(Buffer.from(BASIC.slice(6), "base64").toString()).toBe("ohXpoqrZYub1kg:");
    expect(c.body).toBe('{"scopes":["*","email","pii"]}');
    expect(JSON.parse(c.body!)).toEqual({ scopes: ["*", "email", "pii"] });
    // Android 请求头
    expect(c.headers["user-agent"]).toMatch(/^Reddit\/Version \d{4}\.\d+\.\d+\/Build \d+\/Android (9|1[0-4])$/);
    expect(c.headers["x-reddit-retry"]).toBe("algo=no-retries");
    expect(c.headers["x-reddit-compression"]).toBe("1");
    expect(c.headers["x-reddit-qos"]).toMatch(/^\d+\.\d{3}$/);
    expect(c.headers["x-reddit-media-codecs"]).toMatch(/^available-codecs=video\/avc, video\/hevc(, video\/x-vnd\.on2\.vp9)?$/);
    expect(c.headers["content-type"]).toBe("application/json; charset=UTF-8");
    expect(c.headers["client-vendor-id"]).toBe(FIXED_UUID);
    expect(c.headers["x-reddit-device-id"]).toBe(FIXED_UUID);
    // 不能在 token 请求上带 Bearer / loid
    expect(c.headers["x-reddit-loid"]).toBeUndefined();

    expect(auth.backend).toBe("mobile");
    if (auth.backend === "rss") throw new Error("unreachable");
    expect(auth.headers.Authorization).toBe("Bearer anon-token-AAAAAAAAAAAA");
    expect(auth.headers["x-reddit-loid"]).toBe("loid-value-123456");
    expect(auth.headers["x-reddit-session"]).toBe("session-value-123456");
    expect(auth.headers["client-vendor-id"]).toBe(FIXED_UUID);
  });

  it("caches the token and reuses the same device identity on refresh", async () => {
    const { tm, calls } = manager(() => tokenResponse());
    await tm.getReadAuth();
    await tm.getReadAuth();
    expect(calls).toHaveLength(1);
    await tm.forceRefresh();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers["client-vendor-id"]).toBe(FIXED_UUID);
    expect(calls[1]!.headers["user-agent"]).toBe(calls[0]!.headers["user-agent"]);
  });

  it("never exposes the token or session headers in status()", async () => {
    const { tm } = manager(() => tokenResponse("secret-token-ZZZZZZZZ"));
    await tm.getReadAuth();
    const s = JSON.stringify(tm.status());
    expect(s).not.toContain("secret-token-ZZZZZZZZ");
    expect(s).not.toContain("loid-value-123456");
    expect(s).not.toContain("session-value-123456");
    expect(s).not.toContain(FIXED_UUID);
  });
});

describe("token lifecycle", () => {
  it("refreshes 2 minutes before expiry, not earlier", async () => {
    let n = 0;
    const { tm, calls, clock: c } = manager(() => tokenResponse(`tok-${++n}-xxxxxxxx`, 600));
    await tm.getReadAuth();
    expect(calls).toHaveLength(1);

    c.advance((600 - 121) * 1000); // 距到期 121 s
    let auth = await tm.getReadAuth();
    expect(calls).toHaveLength(1);
    expect(auth.backend !== "rss" && auth.headers.Authorization).toBe("Bearer tok-1-xxxxxxxx");

    c.advance(2000); // 距到期 119 s
    auth = await tm.getReadAuth();
    expect(calls).toHaveLength(2);
    expect(auth.backend !== "rss" && auth.headers.Authorization).toBe("Bearer tok-2-xxxxxxxx");
    expect(tm.status().token?.expires_in_s).toBe(600);
  });

  it("rolls the token over when x-ratelimit-remaining drops to the threshold", async () => {
    let n = 0;
    const { tm, calls } = manager(() => tokenResponse(`tok-${++n}-xxxxxxxx`));
    const first = await tm.getReadAuth();

    tm.noteRateLimit(new Headers({ "x-ratelimit-remaining": "6.0", "x-ratelimit-used": "94", "x-ratelimit-reset": "300" }), first.generation);
    await tm.getReadAuth();
    expect(calls).toHaveLength(1);
    expect(tm.status().rate_limit.remaining).toBe(6);
    expect(tm.status().rate_limit.reset_in_s).toBe(300);

    tm.noteRateLimit(new Headers({ "x-ratelimit-remaining": "5.0", "x-ratelimit-used": "95", "x-ratelimit-reset": "290" }), first.generation);
    expect(tm.status().rate_limit.rollover_pending).toBe(true);
    const second = await tm.getReadAuth();
    expect(calls).toHaveLength(2);
    expect(second.backend !== "rss" && second.headers.Authorization).toBe("Bearer tok-2-xxxxxxxx");
    const st = tm.status();
    expect(st.rate_limit.rollovers).toBe(1);
    expect(st.rate_limit.rollover_pending).toBe(false);
    // 计数清零，等待新 token 的第一个响应
    expect(st.rate_limit.remaining).toBeNull();

    // 旧 token 的迟到响应不再触发轮换
    tm.noteRateLimit(new Headers({ "x-ratelimit-remaining": "0" }), first.generation);
    expect(tm.status().rate_limit.rollover_pending).toBe(false);
  });

  it("keeps the current token when a rollover attempt fails", async () => {
    let n = 0;
    const { tm, calls } = manager(() => (++n === 1 ? tokenResponse("tok-1-xxxxxxxx") : text("nope", 503)));
    const a = await tm.getReadAuth();
    tm.noteRateLimit(new Headers({ "x-ratelimit-remaining": "2" }), a.generation);
    const b = await tm.getReadAuth();
    expect(calls).toHaveLength(2);
    expect(b.backend !== "rss" && b.headers.Authorization).toBe("Bearer tok-1-xxxxxxxx");
    expect(tm.activeBackend).toBe("mobile");
  });

  it("allows only one in-flight token request for concurrent callers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { tm, calls } = manager(async () => {
      await gate;
      return tokenResponse();
    });
    const pending = Array.from({ length: 10 }, () => tm.getReadAuth());
    await Promise.resolve();
    release();
    const results = await Promise.all(pending);
    expect(calls).toHaveLength(1);
    expect(new Set(results.map((r) => r.generation)).size).toBe(1);
  });

  it("invalidate() refreshes only if the failing token is still current", async () => {
    const { tm, calls } = manager(() => tokenResponse());
    const a = await tm.getReadAuth();
    await tm.invalidate(a.generation);
    expect(calls).toHaveLength(2);
    await tm.invalidate(a.generation); // 过期的 generation，忽略
    expect(calls).toHaveLength(2);
  });
});

describe("backend cascade", () => {
  it("falls back mobile -> installed after 5 consecutive mobile failures", async () => {
    const { tm, calls } = manager((c) =>
      c.url === MOBILE_URL ? text("<html>blocked</html>", 403) : json({ access_token: "inst-token-xxxxxx", expires_in: 86400 }),
    );
    const auth = await tm.getReadAuth();

    expect(calls.filter((c) => c.url === MOBILE_URL)).toHaveLength(5);
    const inst = calls.filter((c) => c.url === INSTALLED_URL);
    expect(inst).toHaveLength(1);
    const c = inst[0]!;
    expect(c.method).toBe("POST");
    expect(c.headers.authorization).toBe(BASIC);
    expect(c.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(c.body).toBe(
      `grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=${FIXED_UUID}`,
    );
    expect(c.headers["user-agent"]).toMatch(/^Reddit\/Version /);

    expect(auth.backend).toBe("installed");
    const st = tm.status();
    expect(st.active_backend).toBe("installed");
    expect(st.degraded).toBe(true);
    expect(st.backend_switches).toHaveLength(1);
    expect(st.backend_switches[0]).toMatchObject({ from: "mobile", to: "installed" });
  });

  it("does not fall back before the 5th failure", async () => {
    let n = 0;
    const { tm, calls } = manager((c) => (c.url === MOBILE_URL && ++n <= 4 ? text("err", 500) : tokenResponse()));
    const auth = await tm.getReadAuth();
    expect(auth.backend).toBe("mobile");
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.url === MOBILE_URL)).toBe(true);
    expect(tm.status().consecutive_failures).toBe(0);
  });

  it("falls back installed -> rss after 5 more failures, then reports rss", async () => {
    const { tm, calls } = manager(() => text("<html>blocked</html>", 403));
    const auth = await tm.getReadAuth();
    expect(auth.backend).toBe("rss");
    expect(calls.filter((c) => c.url === MOBILE_URL)).toHaveLength(5);
    expect(calls.filter((c) => c.url === INSTALLED_URL)).toHaveLength(5);
    const st = tm.status();
    expect(st.active_backend).toBe("rss");
    expect(st.degraded).toBe(true);
    expect(st.backend_switches.map((s) => s.to)).toEqual(["installed", "rss"]);
    // 已经是 rss：后续调用不再请求 token
    await tm.getReadAuth();
    expect(calls).toHaveLength(10);
  });

  it("treats a 200 response without access_token as a failure", async () => {
    const { tm } = manager((c) => (c.url === MOBILE_URL ? json({ error: "invalid_client" }) : tokenResponse()));
    const auth = await tm.getReadAuth();
    expect(auth.backend).toBe("installed");
    expect(tm.status().backend_switches[0]?.reason).toContain("invalid_client");
  });

  it("network errors fail the call without counting towards fallback", async () => {
    let down = true;
    const { tm, calls } = manager(() => {
      if (down) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
      return tokenResponse();
    });
    const err = await tm.getReadAuth().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(calls).toHaveLength(1);
    expect(tm.status()).toMatchObject({ active_backend: "mobile", degraded: false, consecutive_failures: 0 });
    down = false;
    expect((await tm.getReadAuth()).backend).toBe("mobile");
  });

  it("recovery from rss tries mobile, then installed", async () => {
    let installedUp = false;
    const { tm, clock: c } = manager((call) => {
      if (call.url === INSTALLED_URL && installedUp) return json({ access_token: "inst-token-xxxxxx", expires_in: 86400 });
      return text("no", 403);
    });
    expect((await tm.getReadAuth()).backend).toBe("rss");
    installedUp = true;
    c.advance(31 * 60_000);
    expect((await tm.getReadAuth()).backend).toBe("installed");
    expect(tm.status().backend_switches.map((s) => s.to)).toEqual(["installed", "rss", "installed"]);
  });

  it("recovers to mobile after the recovery interval", async () => {
    let mobileUp = false;
    const { tm, clock: c } = manager((call) => {
      if (call.url === MOBILE_URL && mobileUp) return tokenResponse("mobile-again-xxxx");
      return text("no", 403);
    });
    expect((await tm.getReadAuth()).backend).toBe("rss");
    mobileUp = true;
    c.advance(10 * 60_000);
    expect((await tm.getReadAuth()).backend).toBe("rss");
    c.advance(21 * 60_000);
    expect((await tm.getReadAuth()).backend).toBe("mobile");
    expect(tm.status().degraded).toBe(false);
  });

  it("pinned mobile mode never falls back and raises an actionable error", async () => {
    const { tm, calls } = manager(() => text("blocked", 403), { mode: "mobile" });
    const err = await tm.getReadAuth().catch((e) => e);
    expect(err).toBeInstanceOf(AuthBackendError);
    expect((err as AuthBackendError).pinned).toBe(true);
    expect((err as AuthBackendError).toolText()).toContain("REDDIT_AUTH_MODE=mobile");
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.url === MOBILE_URL)).toBe(true);
  });

  it("pinned installed mode starts with the installed endpoint", async () => {
    const { tm, calls } = manager(() => json({ access_token: "inst-token-xxxxxx", expires_in: 86400 }), { mode: "installed" });
    expect((await tm.getReadAuth()).backend).toBe("installed");
    expect(calls.map((c) => c.url)).toEqual([INSTALLED_URL]);
  });

  it("pinned rss mode makes no token requests", async () => {
    const { tm, calls } = manager(() => tokenResponse(), { mode: "rss" });
    expect((await tm.getReadAuth()).backend).toBe("rss");
    expect(calls).toHaveLength(0);
  });
});
