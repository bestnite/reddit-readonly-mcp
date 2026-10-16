// 进程级共享状态：token、缓存、限流计数在所有 MCP 会话之间共享。

import type { Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createAndroidDevice, getProcessDevice, type AndroidDevice } from "./auth/device.js";
import { TokenManager } from "./auth/token-manager.js";
import { ResponseCache } from "./client/cache.js";
import { RedditClient } from "./client/reddit-client.js";
import { RssClient } from "./client/rss.js";

export interface AppContext {
  config: Config;
  logger: Logger;
  device: AndroidDevice;
  tokens: TokenManager;
  cache: ResponseCache;
  client: RedditClient;
  rss: RssClient;
  startedAt: number;
}

export interface ContextDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  device?: AndroidDevice;
  // token 后端两次尝试间的退避基数（测试中设为 0）
  retryBackoffMs?: number;
}

export function createContext(config: Config, deps: ContextDeps = {}): AppContext {
  const logger = deps.logger ?? createLogger(config.logLevel);
  // 测试传入 fetch 时用独立设备，避免污染进程单例
  const device = deps.device ?? (deps.fetch ? createAndroidDevice() : getProcessDevice());
  const now = deps.now ?? Date.now;
  const cache = new ResponseCache(config.cacheEnabled, config.cacheMaxBytes, now);
  const tokens = new TokenManager({
    mode: config.authMode,
    mobileClientId: config.mobileClientId,
    device,
    fetch: deps.fetch,
    now,
    sleep: deps.sleep,
    timeoutMs: config.timeoutMs,
    logger,
    retryBackoffMs: deps.retryBackoffMs,
  });
  const client = new RedditClient({
    tokens,
    cache,
    fetch: deps.fetch,
    logger,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    sleep: deps.sleep,
  });
  const rss = new RssClient({
    userAgent: device.userAgent,
    cache,
    fetch: deps.fetch,
    logger,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    sleep: deps.sleep,
  });
  return { config, logger, device, tokens, cache, client, rss, startedAt: now() };
}
