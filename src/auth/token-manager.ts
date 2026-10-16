// 匿名只读 token 的获取与生命周期管理（移植并扩展 redlib 的做法）：
//   - mobile：/auth/v2/oauth/access-token/loid，HTTP Basic(<android client id>:)，JSON body
//   - installed：/api/v1/access_token，installed_client grant，同样的 Basic(<id>:)
//   - rss：不需要 token，由 RSS 后端提供有限的读能力
// auto 模式下按 mobile → installed → rss 级联，每一级连续失败 5 次才切换到下一级。
//
// 注意：这里拿到的永远是 application-only 的匿名 token，只用于读取公开数据。
// 用户 token（写操作）在 user-token.ts，且必须使用用户自己注册的 app，绝不使用 Android client id。

import type { AuthMode } from "../config.js";
import { registerSecret, unregisterSecret, silentLogger, type Logger } from "../logger.js";
import { AuthBackendError, normalizeFetchError } from "../client/errors.js";
import type { AndroidDevice } from "./device.js";

export type TokenBackend = "mobile" | "installed";
export type Backend = TokenBackend | "rss";

export const MOBILE_TOKEN_URL = "https://www.reddit.com/auth/v2/oauth/access-token/loid";
export const INSTALLED_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const MOBILE_TOKEN_BODY = JSON.stringify({ scopes: ["*", "email", "pii"] });
export const INSTALLED_GRANT = "https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client";

export type ReadAuth =
  | { backend: TokenBackend; headers: Record<string, string>; generation: number }
  | { backend: "rss"; generation: number };

export interface TokenManagerOptions {
  mode: AuthMode;
  mobileClientId: string;
  device: AndroidDevice;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  logger?: Logger;
  // 每个 token 后端连续失败多少次才切换（redlib 为 5）
  failureThreshold?: number;
  // 到期前多久刷新（2 分钟）
  refreshMarginMs?: number;
  // x-ratelimit-remaining 低于等于该值时轮换 token
  lowRateLimitThreshold?: number;
  // 同一后端两次尝试之间的退避基数
  retryBackoffMs?: number;
  // 降级后多久再尝试一次 mobile
  recoveryIntervalMs?: number;
}

interface TokenState {
  backend: TokenBackend;
  accessToken: string;
  obtainedAt: number;
  expiresAt: number;
  // x-reddit-loid / x-reddit-session，后续 API 请求原样带上
  sessionHeaders: Record<string, string>;
}

interface RateState {
  remaining: number | null;
  used: number | null;
  resetAt: number | null;
  updatedAt: number | null;
}

export interface BackendSwitch {
  from: Backend;
  to: Backend;
  at: string;
  reason: string;
}

type RefreshReason = "initial" | "expiry" | "rollover" | "unauthorized" | "forced";

export class TokenManager {
  readonly mode: AuthMode;
  private readonly opts: Required<Omit<TokenManagerOptions, "mode" | "device" | "mobileClientId">>;
  private readonly device: AndroidDevice;
  private readonly mobileClientId: string;

  private active: Backend;
  private token: TokenState | null = null;
  // 每换一次 token 自增，用来丢弃旧 token 的迟到响应
  private generation = 0;
  private inflight: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private rolloverPending = false;
  private rate: RateState = { remaining: null, used: null, resetAt: null, updatedAt: null };
  private rollovers = 0;
  private tokenFetches = 0;
  private switches: BackendSwitch[] = [];
  private lastError: string | null = null;
  private degradedAt: number | null = null;
  private lastRecoveryAttempt = 0;

  constructor(options: TokenManagerOptions) {
    this.mode = options.mode;
    this.device = options.device;
    this.mobileClientId = options.mobileClientId;
    this.opts = {
      fetch: options.fetch ?? ((...a) => fetch(...a)),
      now: options.now ?? Date.now,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      timeoutMs: options.timeoutMs ?? 20000,
      logger: options.logger ?? silentLogger,
      failureThreshold: options.failureThreshold ?? 5,
      refreshMarginMs: options.refreshMarginMs ?? 120_000,
      lowRateLimitThreshold: options.lowRateLimitThreshold ?? 5,
      retryBackoffMs: options.retryBackoffMs ?? 500,
      recoveryIntervalMs: options.recoveryIntervalMs ?? 30 * 60_000,
    };
    this.active = this.mode === "auto" ? "mobile" : this.mode;
  }

  get activeBackend(): Backend {
    return this.active;
  }

  // 当前生效的 token 是否已经降级（只在 auto 模式下有意义）
  get degraded(): boolean {
    return this.mode === "auto" && this.active !== "mobile";
  }

  // 取得读请求所需的认证头；处于 rss 后端时返回 {backend:"rss"}
  async getReadAuth(): Promise<ReadAuth> {
    if (this.mode === "rss") return { backend: "rss", generation: this.generation };

    if (this.active === "rss") {
      // 降级到 rss 后，定期尝试恢复 token 后端
      if (this.recoveryDue()) await this.refresh("expiry");
      if (this.active === "rss") return { backend: "rss", generation: this.generation };
    }

    const now = this.opts.now();
    if (!this.token) {
      await this.refresh("initial");
    } else if (now >= this.token.expiresAt - this.opts.refreshMarginMs) {
      await this.refresh("expiry");
    } else if (this.rolloverPending) {
      await this.refresh("rollover");
    }

    // refresh() 可能已经切换了后端，这里重新读取
    const token = this.token as TokenState | null;
    if (this.activeBackend === "rss" || !token) return { backend: "rss", generation: this.generation };
    return { backend: token.backend, headers: this.buildHeaders(token), generation: this.generation };
  }

  // 收到 401：若该 token 仍是当前 token，则作废并刷新一次
  async invalidate(generation: number): Promise<void> {
    if (generation !== this.generation || !this.token) return;
    await this.refresh("unauthorized");
  }

  async forceRefresh(): Promise<void> {
    await this.refresh("forced");
  }

  // 从每个 API 响应头里记录限流状态；剩余额度过低时标记需要轮换 token
  noteRateLimit(headers: Headers, generation: number): void {
    if (generation !== this.generation) return;
    const remaining = parseNum(headers.get("x-ratelimit-remaining"));
    const used = parseNum(headers.get("x-ratelimit-used"));
    const reset = parseNum(headers.get("x-ratelimit-reset"));
    if (remaining === null && used === null && reset === null) return;
    const now = this.opts.now();
    this.rate = {
      remaining,
      used,
      resetAt: reset === null ? null : now + reset * 1000,
      updatedAt: now,
    };
    if (remaining !== null && remaining <= this.opts.lowRateLimitThreshold && this.token && !this.rolloverPending) {
      this.rolloverPending = true;
      this.opts.logger.info(
        `Rate limit low (remaining=${remaining}); rolling over to a fresh ${this.token.backend} token before the next request`,
      );
    }
  }

  status() {
    const now = this.opts.now();
    const t = this.token;
    return {
      mode: this.mode,
      active_backend: this.active,
      degraded: this.degraded,
      degraded_since: this.degradedAt === null ? null : new Date(this.degradedAt).toISOString(),
      consecutive_failures: this.consecutiveFailures,
      failure_threshold: this.opts.failureThreshold,
      last_error: this.lastError,
      backend_switches: this.switches.slice(-10),
      token: t
        ? {
            backend: t.backend,
            obtained_at: new Date(t.obtainedAt).toISOString(),
            expires_at: new Date(t.expiresAt).toISOString(),
            expires_in_s: Math.max(0, Math.round((t.expiresAt - now) / 1000)),
            refresh_margin_s: this.opts.refreshMarginMs / 1000,
          }
        : null,
      token_fetches: this.tokenFetches,
      rate_limit: {
        remaining: this.rate.remaining,
        used: this.rate.used,
        reset_at: this.rate.resetAt === null ? null : new Date(this.rate.resetAt).toISOString(),
        reset_in_s: this.rate.resetAt === null ? null : Math.max(0, Math.round((this.rate.resetAt - now) / 1000)),
        rollover_threshold: this.opts.lowRateLimitThreshold,
        rollover_pending: this.rolloverPending,
        rollovers: this.rollovers,
      },
      device: {
        user_agent: this.device.userAgent,
        app_version: this.device.appVersion,
        android_version: this.device.androidVersion,
      },
    };
  }

  // ---------------------------------------------------------------------------

  private recoveryDue(): boolean {
    return (
      this.mode === "auto" &&
      this.active !== "mobile" &&
      this.opts.now() - this.lastRecoveryAttempt >= this.opts.recoveryIntervalMs
    );
  }

  // 同一时刻只允许一个刷新在进行，并发调用共享同一个 promise
  private refresh(reason: RefreshReason): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh(reason).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doRefresh(reason: RefreshReason): Promise<void> {
    const now = this.opts.now();

    // 轮换：旧 token 仍然有效时只尝试一次，失败就继续用旧 token，不触发级联
    if (reason === "rollover" && this.token && this.active !== "rss" && now < this.token.expiresAt - this.opts.refreshMarginMs) {
      this.rolloverPending = false;
      try {
        this.install(await this.requestToken(this.active));
        this.rollovers++;
        this.opts.logger.info(`Token rolled over (${this.active}); rate-limit window reset`);
      } catch (err) {
        this.lastError = errDetail(err);
        this.opts.logger.warn(`Token rollover failed, keeping the current token: ${this.lastError}`);
      }
      return;
    }

    // 降级状态下的恢复尝试：只试一次 mobile
    if (this.recoveryDue()) {
      this.lastRecoveryAttempt = now;
      try {
        const tok = await this.requestToken("mobile");
        this.switchTo("mobile", "recovered: mobile token endpoint works again");
        this.install(tok);
        this.consecutiveFailures = 0;
        return;
      } catch (err) {
        this.opts.logger.info(`Recovery attempt on mobile backend failed: ${errDetail(err)}`);
      }
    }

    for (;;) {
      const backend = this.active;
      if (backend === "rss") {
        this.dropToken();
        return;
      }
      try {
        this.install(await this.requestToken(backend));
        this.consecutiveFailures = 0;
        return;
      } catch (err) {
        const detail = errDetail(err);
        this.consecutiveFailures++;
        this.lastError = `${backend}: ${detail}`;
        this.opts.logger.warn(
          `Failed to obtain ${backend} token (${this.consecutiveFailures}/${this.opts.failureThreshold}): ${detail}`,
        );
        if (this.consecutiveFailures >= this.opts.failureThreshold) {
          this.consecutiveFailures = 0;
          if (this.mode !== "auto") {
            throw new AuthBackendError(backend, detail, true);
          }
          const next: Backend = backend === "mobile" ? "installed" : "rss";
          this.switchTo(next, `${this.opts.failureThreshold} consecutive ${backend} token failures (last: ${detail})`);
          continue;
        }
        await this.opts.sleep(this.opts.retryBackoffMs * this.consecutiveFailures);
      }
    }
  }

  private switchTo(next: Backend, reason: string): void {
    const from = this.active;
    if (from === next) return;
    this.active = next;
    this.switches.push({ from, to: next, at: new Date(this.opts.now()).toISOString(), reason });
    if (this.switches.length > 50) this.switches.shift();
    if (next === "mobile") {
      this.degradedAt = null;
      this.opts.logger.warn(`Auth backend switched ${from} -> ${next}: ${reason}`);
    } else {
      this.degradedAt ??= this.opts.now();
      this.lastRecoveryAttempt = this.opts.now();
      this.opts.logger.warn(`Auth backend degraded ${from} -> ${next}: ${reason}`);
    }
  }

  private install(tok: TokenState): void {
    if (this.token) {
      unregisterSecret(this.token.accessToken);
    }
    this.token = tok;
    this.generation++;
    this.rolloverPending = false;
    // 新 token 拥有新的限流窗口，计数清零（下次响应时重新读取）
    this.rate = { remaining: null, used: null, resetAt: null, updatedAt: null };
  }

  private dropToken(): void {
    if (this.token) unregisterSecret(this.token.accessToken);
    this.token = null;
    this.generation++;
    this.rolloverPending = false;
  }

  private buildHeaders(token: TokenState): Record<string, string> {
    return {
      ...this.device.headers,
      ...token.sessionHeaders,
      Authorization: `Bearer ${token.accessToken}`,
    };
  }

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${this.mobileClientId}:`).toString("base64")}`;
  }

  // 构造 token 请求（导出给测试用于断言请求细节）
  buildTokenRequest(backend: TokenBackend): { url: string; init: RequestInit & { headers: Record<string, string> } } {
    if (backend === "mobile") {
      return {
        url: MOBILE_TOKEN_URL,
        init: {
          method: "POST",
          headers: { ...this.device.headers, Authorization: this.basicAuth() },
          body: MOBILE_TOKEN_BODY,
        },
      };
    }
    return {
      url: INSTALLED_TOKEN_URL,
      init: {
        method: "POST",
        headers: {
          ...this.device.headers,
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: this.basicAuth(),
        },
        body: `grant_type=${INSTALLED_GRANT}&device_id=${encodeURIComponent(this.device.uuid)}`,
      },
    };
  }

  private async requestToken(backend: TokenBackend): Promise<TokenState> {
    const { url, init } = this.buildTokenRequest(backend);
    this.tokenFetches++;
    let res: Response;
    try {
      res = await this.opts.fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      throw normalizeFetchError(err, this.opts.timeoutMs);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`token endpoint returned HTTP ${res.status}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`token endpoint returned non-JSON (HTTP ${res.status})`);
    }
    const obj = json as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (typeof obj.access_token !== "string" || obj.access_token === "") {
      const e = typeof obj.error === "string" ? ` (error=${obj.error})` : "";
      throw new Error(`token response has no access_token${e}`);
    }
    const expiresIn = typeof obj.expires_in === "number" ? obj.expires_in : Number(obj.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("token response has no valid expires_in");
    }

    const sessionHeaders: Record<string, string> = {};
    for (const h of ["x-reddit-loid", "x-reddit-session"]) {
      const v = res.headers.get(h);
      if (v) {
        sessionHeaders[h] = v;
        registerSecret(v);
      }
    }
    registerSecret(obj.access_token);
    const now = this.opts.now();
    this.opts.logger.info(`Obtained ${backend} read token (expires in ${Math.round(expiresIn)} s)`);
    return {
      backend,
      accessToken: obj.access_token,
      obtainedAt: now,
      expiresAt: now + expiresIn * 1000,
      sessionHeaders,
    };
  }
}

function parseNum(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function errDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
