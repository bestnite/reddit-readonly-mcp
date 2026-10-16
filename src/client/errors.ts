// 类型化错误：内部用英文 message 记录细节，toToolErrorText() 负责转换成面向 agent 的文案。

import { E } from "../messages.js";
import { redact } from "../logger.js";

export class RedditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
  // 面向 agent 的文本，子类覆盖
  toolText(): string {
    return this.message;
  }
}

export class HttpError extends RedditError {
  constructor(
    readonly status: number,
    readonly what: string,
    // 响应不是 JSON（例如 403 拦截页 HTML）
    readonly nonJson = false,
  ) {
    super(`HTTP ${status} for ${what}`);
  }
  override toolText(): string {
    if (this.status === 404) return E.notFound(this.what);
    if (this.status === 403) return E.forbidden(this.what);
    return E.http(this.status, this.what);
  }
}

export class RedirectError extends RedditError {
  constructor(readonly what: string, readonly location: string | null) {
    super(`Redirected (${location ?? "no location"}) for ${what}`);
  }
  override toolText(): string {
    return E.redirected(this.what);
  }
}

export class RateLimitError extends RedditError {
  constructor(readonly retryAfterSeconds: number | null) {
    super(`HTTP 429 rate limited (retry after ${retryAfterSeconds ?? "?"} s)`);
  }
  override toolText(): string {
    return E.rateLimited(this.retryAfterSeconds);
  }
}

export class TimeoutError extends RedditError {
  constructor(readonly ms: number) {
    super(`Request timed out after ${ms} ms`);
  }
  override toolText(): string {
    return E.timeout(this.ms);
  }
}

export class NetworkError extends RedditError {
  constructor(readonly detail: string) {
    super(`Network error: ${detail}`);
  }
  override toolText(): string {
    return E.network(this.detail);
  }
}

// Reddit 业务错误：例如 {"json":{"errors":[["USER_REQUIRED","Please log in", null]]}}
export class RedditApiError extends RedditError {
  constructor(
    readonly what: string,
    readonly errors: Array<[string, string, ...unknown[]]>,
  ) {
    super(`Reddit API errors for ${what}: ${errors.map((e) => e.slice(0, 2).join(": ")).join("; ")}`);
  }
  hasCode(code: string): boolean {
    return this.errors.some((e) => e[0] === code);
  }
  override toolText(): string {
    if (this.hasCode("USER_REQUIRED")) return E.userRequired(this.what);
    return E.redditApi(this.what, this.errors.map((e) => `${e[0]} (${e[1]})`).join("; "));
  }
}

// token 获取失败
export class AuthBackendError extends RedditError {
  constructor(
    readonly backend: string,
    readonly detail: string,
    readonly pinned: boolean,
  ) {
    super(`Token backend ${backend} failed: ${detail}`);
  }
  override toolText(): string {
    if (this.backend === "rss" && this.pinned) return E.rssPinnedFailed(this.detail);
    return this.pinned ? E.pinnedBackendFailed(this.backend, this.detail) : E.allBackendsFailed(this.detail);
  }
}

// 当前处于 RSS 后端，而该工具无法用 RSS 实现
export class RssUnsupportedError extends RedditError {
  constructor(readonly tool: string) {
    super(`Tool ${tool} is not supported on the RSS backend`);
  }
  override toolText(): string {
    return E.rssUnsupported(this.tool);
  }
}

// 内部信号：读请求发起时发现当前处于 rss 后端；工具层会把它换成带工具名的 RssUnsupportedError
export class RssModeActiveError extends RedditError {
  constructor() {
    super("Read backend is RSS; the oauth API is not available");
  }
  override toolText(): string {
    return E.rssUnsupported("This tool");
  }
}

// 输入校验错误：message 本身就是给 agent 看的文本
export class ToolInputError extends RedditError {}

export function toToolErrorText(err: unknown): string {
  const text =
    err instanceof RedditError ? err.toolText() : E.internal(err instanceof Error ? err.message : String(err));
  return redact(text);
}

// 把 fetch 抛出的底层异常归一化
export function normalizeFetchError(err: unknown, timeoutMs: number): RedditError {
  if (err instanceof RedditError) return err;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return new TimeoutError(timeoutMs);
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? err.message;
    return new NetworkError(detail);
  }
  return new NetworkError(String(err));
}
