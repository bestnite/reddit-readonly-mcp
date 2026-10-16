// 测试辅助：可编程的 fetch 替身（不访问网络）、固定设备、可控时钟。

import { createAndroidDevice } from "../src/auth/device.js";
import { loadConfig, type Config } from "../src/config.js";
import { createContext } from "../src/context.js";
import { silentLogger } from "../src/logger.js";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Handler = (call: Call) => Response | Promise<Response>;

export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = async (input: unknown, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

export const FIXED_UUID = "11111111-2222-4333-8444-555555555555";
// 固定随机数，生成可预期的设备
export const fixedDevice = () => createAndroidDevice(() => 0.5, FIXED_UUID);

export function clock(start = Date.UTC(2026, 9, 16, 0, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const tokenResponse = (token = "anon-token-AAAAAAAAAAAA", expiresIn = 86400) =>
  json({ access_token: token, expires_in: expiresIn }, 200, {
    "x-reddit-loid": "loid-value-123456",
    "x-reddit-session": "session-value-123456",
  });

export const isTokenUrl = (url: string) => url.startsWith("https://www.reddit.com/auth/v2/") || url.startsWith("https://www.reddit.com/api/v1/access_token");

export function testContext(env: Record<string, string>, handler: Handler, now?: () => number) {
  const { config } = loadConfig(env);
  const { fetch, calls } = mockFetch(handler);
  const ctx = createContext(config as Config, {
    fetch,
    now,
    sleep: async () => {},
    logger: silentLogger,
    device: fixedDevice(),
    retryBackoffMs: 0,
  });
  return { ctx, calls };
}

export const listing = (children: Array<{ kind: string; data: Record<string, unknown> }>, after: string | null = null) => ({
  kind: "Listing",
  data: { after, children },
});

export const rawPost = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "t3",
  data: {
    id,
    name: `t3_${id}`,
    title: `Title ${id}`,
    author: "alice",
    subreddit: "LocalLLaMA",
    score: 42,
    upvote_ratio: 0.97,
    num_comments: 7,
    created_utc: 1760000000,
    permalink: `/r/LocalLLaMA/comments/${id}/title/`,
    url: `https://www.reddit.com/r/LocalLLaMA/comments/${id}/title/`,
    is_self: true,
    selftext: "hello",
    // 原始 JSON 中大量无关字段，裁剪后不应出现
    preview: { images: [{ source: { url: "x" } }] },
    all_awardings: [],
    media_metadata: { a: 1 },
    ...extra,
  },
});
