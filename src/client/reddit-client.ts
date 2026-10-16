// oauth.reddit.com 请求封装：
//   - 匿名读：Android 设备头 + 匿名 token + loid/session，记录限流头，401 刷新重试一次，可缓存
//   - 用户请求：用户 token + 自己的 UA（不带任何 Android 头），401 刷新重试一次，不缓存
//   - 两者共用：超时、429 按 Retry-After 退避重试、3xx 不跟随

import { silentLogger, type Logger } from "../logger.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { UserTokenManager } from "../auth/user-token.js";
import type { ResponseCache } from "./cache.js";
import {
  HttpError,
  RateLimitError,
  RedirectError,
  RedditApiError,
  RssModeActiveError,
  normalizeFetchError,
} from "./errors.js";

export const API_BASE = "https://oauth.reddit.com";

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RedditClientOptions {
  tokens: TokenManager;
  userAuth: UserTokenManager;
  cache: ResponseCache;
  fetch?: typeof fetch;
  logger?: Logger;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // 429 时单次最长等待
  maxRetryWaitMs?: number;
}

export interface ReadOptions {
  // 出错时在提示中描述请求对象，例如 "r/LocalLLaMA"
  what: string;
  // 缓存时长，0 表示不缓存
  cacheTtlMs?: number;
}

export interface UserRequestOptions {
  what: string;
  tool: string;
  method?: "GET" | "POST";
  query?: Query;
  form?: Query;
}

interface RawResult {
  status: number;
  headers: Headers;
  text: string;
}

export function buildUrl(path: string, query: Query = {}): string {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function toForm(form: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (v === undefined || v === null) continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export class RedditClient {
  readonly tokens: TokenManager;
  readonly userAuth: UserTokenManager;
  readonly cache: ResponseCache;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetryWaitMs: number;
  private stats = { requests: 0, retries429: 0, unauthorizedRetries: 0, errors: 0 };

  constructor(o: RedditClientOptions) {
    this.tokens = o.tokens;
    this.userAuth = o.userAuth;
    this.cache = o.cache;
    this.fetchImpl = o.fetch ?? ((...a) => fetch(...a));
    this.logger = o.logger ?? silentLogger;
    this.maxRetries = o.maxRetries ?? 3;
    this.timeoutMs = o.timeoutMs ?? 20000;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetryWaitMs = o.maxRetryWaitMs ?? 60_000;
  }

  requestStats() {
    return { ...this.stats };
  }

  // 匿名读请求；当前为 rss 后端时抛 RssModeActiveError
  async read<T>(path: string, query: Query, opts: ReadOptions): Promise<T> {
    const url = buildUrl(path, { ...query, raw_json: 1 });
    const ttl = opts.cacheTtlMs ?? 0;
    if (ttl > 0) {
      const hit = this.cache.get<T>(url);
      if (hit !== undefined) return hit;
    }

    let auth = await this.tokens.getReadAuth();
    if (auth.backend === "rss") throw new RssModeActiveError();
    let res = await this.send(url, { method: "GET", headers: auth.headers }, (h) =>
      this.tokens.noteRateLimit(h, auth.generation),
    );

    if (res.status === 401) {
      // token 失效：刷新一次再重试
      this.stats.unauthorizedRetries++;
      this.logger.info(`HTTP 401 on ${opts.what}; refreshing read token and retrying once`);
      await this.tokens.invalidate(auth.generation);
      auth = await this.tokens.getReadAuth();
      if (auth.backend === "rss") throw new RssModeActiveError();
      const retryAuth = auth;
      res = await this.send(url, { method: "GET", headers: retryAuth.headers }, (h) =>
        this.tokens.noteRateLimit(h, retryAuth.generation),
      );
    }

    const json = this.parse<T>(res, opts.what);
    if (ttl > 0) this.cache.set(url, json, res.text.length, ttl);
    return json;
  }

  // 需要用户 token 的请求（写操作、get_me 等）
  async user<T>(path: string, opts: UserRequestOptions): Promise<T> {
    const method = opts.method ?? "GET";
    const url = buildUrl(path, { ...(opts.query ?? {}), raw_json: 1 });
    const body = opts.form ? toForm({ ...opts.form, api_type: "json" }) : undefined;

    const doSend = async () => {
      const token = await this.userAuth.getToken(opts.tool);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.userAuth.userAgent,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
      return this.send(url, { method, headers, body });
    };

    let res = await doSend();
    if (res.status === 401) {
      this.stats.unauthorizedRetries++;
      this.userAuth.invalidate();
      res = await doSend();
    }
    return this.parse<T>(res, opts.what);
  }

  // ---------------------------------------------------------------------------

  private parse<T>(res: RawResult, what: string): T {
    if (res.status >= 300 && res.status < 400) {
      this.stats.errors++;
      throw new RedirectError(what, res.headers.get("location"));
    }
    let json: unknown;
    let parsed = false;
    try {
      json = JSON.parse(res.text);
      parsed = true;
    } catch {
      // 非 JSON（例如 403 拦截页）
    }
    if (res.status < 200 || res.status >= 300) {
      this.stats.errors++;
      throw new HttpError(res.status, what, !parsed);
    }
    if (!parsed) {
      this.stats.errors++;
      throw new HttpError(res.status, what, true);
    }
    // Reddit 业务错误：{"json":{"errors":[[code,msg,field],...]}}
    const errs = (json as { json?: { errors?: unknown } } | null)?.json?.errors;
    if (Array.isArray(errs) && errs.length > 0) {
      this.stats.errors++;
      throw new RedditApiError(what, errs as Array<[string, string]>);
    }
    return json as T;
  }

  private async send(url: string, init: RequestInit, onHeaders?: (h: Headers) => void): Promise<RawResult> {
    for (let attempt = 0; ; attempt++) {
      this.stats.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        this.stats.errors++;
        throw normalizeFetchError(err, this.timeoutMs);
      }
      onHeaders?.(res.headers);
      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        throw normalizeFetchError(err, this.timeoutMs);
      }

      if (res.status !== 429) return { status: res.status, headers: res.headers, text };

      const waitMs = retryAfterMs(res.headers, attempt);
      if (attempt >= this.maxRetries || waitMs > this.maxRetryWaitMs) {
        this.stats.errors++;
        throw new RateLimitError(waitMs / 1000);
      }
      this.stats.retries429++;
      this.logger.warn(`HTTP 429 from Reddit; retry ${attempt + 1}/${this.maxRetries} in ${Math.ceil(waitMs)} ms`);
      await this.sleep(waitMs);
    }
  }
}

// 429 等待时长：优先 Retry-After（秒或 HTTP 日期），其次 x-ratelimit-reset，否则指数退避
export function retryAfterMs(headers: Headers, attempt: number): number {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(ra);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-reset") && Number.isFinite(reset) && reset >= 0) return reset * 1000;
  return Math.min(1000 * 2 ** attempt, 30_000);
}

