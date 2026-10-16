// 运行配置：全部来自环境变量，均为可选，缺省值与 README 中的配置表保持一致。

export type AuthMode = "auto" | "mobile" | "installed" | "rss";
export type SafeModeLevel = "off" | "standard" | "strict";
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export const DEFAULT_MOBILE_CLIENT_ID = "ohXpoqrZYub1kg";
export const PACKAGE_NAME = "reddit-mcp";
export const PACKAGE_VERSION = "0.1.0";

export interface Config {
  authMode: AuthMode;
  mobileClientId: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  safeMode: SafeModeLevel;
  botDisclosure: boolean;
  botFooter?: string;
  cacheEnabled: boolean;
  cacheMaxBytes: number;
  maxRetries: number;
  timeoutMs: number;
  logLevel: LogLevel;
}

type Env = Record<string, string | undefined>;

// 空字符串视为未设置，避免 `REDDIT_PASSWORD=` 这类写法被当成有效凭据
function str(env: Env, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T, problems: string[]): T {
  const v = str(env, key);
  if (v === undefined) return fallback;
  const lower = v.toLowerCase() as T;
  if (allowed.includes(lower)) return lower;
  problems.push(`${key}=${JSON.stringify(v)} is not one of ${allowed.join(", ")}; using "${fallback}"`);
  return fallback;
}

function num(env: Env, key: string, fallback: number, min: number, problems: string[]): number {
  const v = str(env, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) {
    problems.push(`${key}=${JSON.stringify(v)} is not a number >= ${min}; using ${fallback}`);
    return fallback;
  }
  return n;
}

export interface LoadedConfig {
  config: Config;
  // 配置里无效的取值（只描述变量名和取值规则，不回显凭据）
  problems: string[];
}

export function loadConfig(env: Env = process.env): LoadedConfig {
  const problems: string[] = [];
  const config: Config = {
    authMode: oneOf(env, "REDDIT_AUTH_MODE", ["auto", "mobile", "installed", "rss"] as const, "auto", problems),
    mobileClientId: str(env, "REDDIT_MOBILE_CLIENT_ID") ?? DEFAULT_MOBILE_CLIENT_ID,
    clientId: str(env, "REDDIT_CLIENT_ID"),
    clientSecret: str(env, "REDDIT_CLIENT_SECRET"),
    username: str(env, "REDDIT_USERNAME"),
    // 密码不 trim：首尾空格可能是密码的一部分
    password: env.REDDIT_PASSWORD === undefined || env.REDDIT_PASSWORD === "" ? undefined : env.REDDIT_PASSWORD,
    safeMode: oneOf(env, "REDDIT_SAFE_MODE", ["off", "standard", "strict"] as const, "standard", problems),
    botDisclosure: oneOf(env, "REDDIT_BOT_DISCLOSURE", ["auto", "off"] as const, "off", problems) === "auto",
    botFooter: env.REDDIT_BOT_FOOTER === undefined || env.REDDIT_BOT_FOOTER === "" ? undefined : env.REDDIT_BOT_FOOTER,
    cacheEnabled: oneOf(env, "REDDIT_CACHE", ["on", "off"] as const, "on", problems) === "on",
    cacheMaxBytes: Math.floor(num(env, "REDDIT_CACHE_MAX_MB", 50, 1, problems) * 1024 * 1024),
    maxRetries: Math.floor(num(env, "REDDIT_MAX_RETRIES", 3, 0, problems)),
    timeoutMs: Math.floor(num(env, "REDDIT_TIMEOUT_MS", 20000, 1000, problems)),
    logLevel: oneOf(env, "REDDIT_LOG_LEVEL", ["debug", "info", "warn", "error", "silent"] as const, "info", problems),
  };
  return { config, problems };
}

// 写操作需要的四个变量；返回缺失的变量名（绝不返回取值）
export function missingWriteVars(config: Config): string[] {
  const missing: string[] = [];
  if (!config.clientId) missing.push("REDDIT_CLIENT_ID");
  if (!config.clientSecret) missing.push("REDDIT_CLIENT_SECRET");
  if (!config.username) missing.push("REDDIT_USERNAME");
  if (!config.password) missing.push("REDDIT_PASSWORD");
  return missing;
}
