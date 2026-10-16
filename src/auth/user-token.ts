// 写操作 / 账号工具使用的用户 token：password grant，必须使用用户自己注册的 Reddit app
// （REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET）+ 账号（REDDIT_USERNAME / REDDIT_PASSWORD）。
// 与匿名读 token 完全隔离：不复用 Android 设备头，不复用 Android client id。

import { DEFAULT_MOBILE_CLIENT_ID, missingWriteVars, PACKAGE_NAME, PACKAGE_VERSION, type Config } from "../config.js";
import { registerCredential, registerSecret, unregisterSecret, silentLogger, type Logger } from "../logger.js";
import { MissingCredentialsError, ToolInputError, normalizeFetchError } from "../client/errors.js";
import { E } from "../messages.js";

export const USER_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

export interface UserTokenOptions {
  config: Config;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  logger?: Logger;
  refreshMarginMs?: number;
}

interface UserToken {
  accessToken: string;
  expiresAt: number;
}

export class UserTokenManager {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly refreshMarginMs: number;
  private token: UserToken | null = null;
  private inflight: Promise<string> | null = null;
  private lastError: string | null = null;

  constructor(o: UserTokenOptions) {
    this.config = o.config;
    this.fetchImpl = o.fetch ?? ((...a) => fetch(...a));
    this.now = o.now ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? 20000;
    this.logger = o.logger ?? silentLogger;
    this.refreshMarginMs = o.refreshMarginMs ?? 120_000;
    registerCredential(this.config.password);
    registerCredential(this.config.clientSecret);
  }

  // Reddit 要求的 UA 格式：<platform>:<app id>:<version> (by /u/<username>)
  get userAgent(): string {
    const who = this.config.username ? ` (by /u/${this.config.username})` : "";
    return `node:${PACKAGE_NAME}:${PACKAGE_VERSION}${who}`;
  }

  get username(): string | undefined {
    return this.config.username;
  }

  missing(): string[] {
    return missingWriteVars(this.config);
  }

  get configured(): boolean {
    return this.missing().length === 0;
  }

  // 若缺少任一变量，抛出列明缺失变量的错误
  assertConfigured(tool: string): void {
    const missing = this.missing();
    if (missing.length > 0) throw new MissingCredentialsError(tool, missing);
    // 硬性约束：Android client id 永远不能与账号密码一起使用
    if (this.clientIdIsAndroidId()) throw new ToolInputError(E.mobileIdForUserGrant);
  }

  // 与当前配置的 Android id 或默认 Android id 相同（忽略大小写）都视为 Android id
  private clientIdIsAndroidId(): boolean {
    const id = this.config.clientId?.toLowerCase();
    if (!id) return false;
    return id === this.config.mobileClientId.toLowerCase() || id === DEFAULT_MOBILE_CLIENT_ID.toLowerCase();
  }

  async getToken(tool: string): Promise<string> {
    this.assertConfigured(tool);
    if (this.token && this.now() < this.token.expiresAt - this.refreshMarginMs) return this.token.accessToken;
    this.inflight ??= this.requestToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  invalidate(): void {
    if (this.token) unregisterSecret(this.token.accessToken);
    this.token = null;
  }

  status() {
    return {
      configured: this.configured,
      // 只报告变量名是否设置，不报告取值
      env: {
        REDDIT_CLIENT_ID: Boolean(this.config.clientId),
        REDDIT_CLIENT_SECRET: Boolean(this.config.clientSecret),
        REDDIT_USERNAME: Boolean(this.config.username),
        REDDIT_PASSWORD: Boolean(this.config.password),
      },
      missing: this.missing(),
      client_id_is_android_id: this.clientIdIsAndroidId(),
      token_cached: this.token !== null,
      token_expires_at: this.token ? new Date(this.token.expiresAt).toISOString() : null,
      last_error: this.lastError,
    };
  }

  // 构造请求（测试会断言：使用注册 app 的 Basic，不带任何 Android 头）
  buildTokenRequest(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
    const c = this.config;
    const basic = Buffer.from(`${c.clientId ?? ""}:${c.clientSecret ?? ""}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "password",
      username: c.username ?? "",
      password: c.password ?? "",
    }).toString();
    return {
      url: USER_TOKEN_URL,
      init: {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": this.userAgent,
          Accept: "application/json",
        },
        body,
      },
    };
  }

  private async requestToken(): Promise<string> {
    const { url, init } = this.buildTokenRequest();
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const e = normalizeFetchError(err, this.timeoutMs);
      this.lastError = e.message;
      throw e;
    }
    const text = await res.text().catch(() => "");
    let json: { access_token?: unknown; expires_in?: unknown; error?: unknown } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      // 非 JSON 时按状态码处理
    }
    if (res.status === 401 || res.status === 403) {
      this.lastError = `HTTP ${res.status}`;
      throw new ToolInputError(E.userAuthRejected(`HTTP ${res.status}: client id/secret not accepted`));
    }
    if (typeof json.error === "string") {
      this.lastError = json.error;
      throw new ToolInputError(E.userAuthRejected(json.error));
    }
    if (!res.ok || typeof json.access_token !== "string") {
      this.lastError = `HTTP ${res.status}`;
      throw new ToolInputError(E.userAuthRejected(`HTTP ${res.status}, no access_token`));
    }
    const expiresIn = Number(json.expires_in ?? 3600);
    registerSecret(json.access_token);
    this.invalidate();
    this.token = { accessToken: json.access_token, expiresAt: this.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 };
    this.lastError = null;
    this.logger.info(`Obtained user token for write operations (expires in ${Math.round(expiresIn)} s)`);
    return json.access_token;
  }
}
