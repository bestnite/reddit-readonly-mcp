// 诊断工具：报告读后端状态、限流、写操作就绪情况与缓存统计。从不输出任何凭据或 token。

import { DEFAULT_MOBILE_CLIENT_ID, PACKAGE_NAME, PACKAGE_VERSION } from "../config.js";
import { toToolErrorText } from "../client/errors.js";
import { readTool } from "./define.js";

export default readTool("doctor", "Doctor (diagnostics)", {}, async (_args, ctx) => {
  // 确保至少尝试过一次取 token，这样报告的是真实状态
  let tokenCheck: { ok: boolean; error?: string };
  try {
    await ctx.tokens.getReadAuth();
    tokenCheck = { ok: true };
  } catch (err) {
    tokenCheck = { ok: false, error: toToolErrorText(err) };
  }
  const read = ctx.tokens.status();
  const write = ctx.userAuth.status();
  return {
    server: {
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      node: process.version,
      uptime_s: Math.round((Date.now() - ctx.startedAt) / 1000),
    },
    read_backend: {
      ...read,
      token_check: tokenCheck,
      mobile_client_id: ctx.config.mobileClientId === DEFAULT_MOBILE_CLIENT_ID ? "default" : "overridden (REDDIT_MOBILE_CLIENT_ID)",
      rss_capable_tools: ["browse_subreddit", "get_top_posts"],
      note:
        read.rate_limit.remaining === null
          ? "rate_limit fields are null until the first oauth.reddit.com response with the current token"
          : undefined,
    },
    rss: ctx.rss.status(),
    write: {
      ready: write.configured && !write.client_id_is_android_id,
      ...write,
      note: "Write tools use only REDDIT_CLIENT_ID/SECRET + REDDIT_USERNAME/PASSWORD; the anonymous Android token is read-only by design.",
    },
    safe_mode: ctx.safeMode.status(),
    bot_disclosure: ctx.disclosure.status(),
    cache: ctx.cache.stats(),
    requests: ctx.client.requestStats(),
    config: {
      auth_mode: ctx.config.authMode,
      timeout_ms: ctx.config.timeoutMs,
      max_retries: ctx.config.maxRetries,
    },
  };
});
