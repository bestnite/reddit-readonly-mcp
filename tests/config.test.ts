import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli-args.js";
import { loadConfig } from "../src/config.js";
import { createLogger, redact, registerSecret } from "../src/logger.js";

describe("config", () => {
  it("applies the documented defaults", () => {
    const { config, problems } = loadConfig({});
    expect(config).toMatchObject({
      authMode: "auto",
      mobileClientId: "ohXpoqrZYub1kg",
      cacheEnabled: true,
      cacheMaxBytes: 50 * 1024 * 1024,
      maxRetries: 3,
      timeoutMs: 20000,
    });
    expect(problems).toEqual([]);
  });

  it("reads overrides and reports invalid values", () => {
    const { config, problems } = loadConfig({
      REDDIT_AUTH_MODE: "RSS",
      REDDIT_MOBILE_CLIENT_ID: "otherId",
      REDDIT_CACHE: "maybe",
      REDDIT_CACHE_MAX_MB: "abc",
    });
    expect(config.authMode).toBe("rss");
    expect(config.mobileClientId).toBe("otherId");
    expect(config.cacheEnabled).toBe(true);
    expect(problems).toHaveLength(2);
  });

  it("ignores the removed credential / write variables", () => {
    const { config, problems } = loadConfig({
      REDDIT_CLIENT_ID: "myAppId123",
      REDDIT_CLIENT_SECRET: "myAppSecret456",
      REDDIT_USERNAME: "botuser",
      REDDIT_PASSWORD: "hunter2-password",
      REDDIT_SAFE_MODE: "paranoid",
      REDDIT_BOT_DISCLOSURE: "auto",
      REDDIT_BOT_FOOTER: "footer",
    });
    expect(config).toEqual(loadConfig({}).config);
    expect(JSON.stringify(config)).not.toMatch(/myAppId123|myAppSecret456|botuser|hunter2|footer/);
    expect(problems).toEqual([]);
  });
});

describe("logger", () => {
  it("writes redacted lines and masks registered secrets", () => {
    const lines: string[] = [];
    registerSecret("super-secret-value");
    const log = createLogger("info", (l) => lines.push(l));
    log.debug("hidden");
    log.info("Authorization: Bearer abc.def-123456789xyz and super-secret-value");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Bearer [REDACTED]");
    expect(lines[0]).not.toContain("super-secret-value");
    expect(redact("Basic b2hYcG9xclpZdWIxa2c6")).toBe("Basic [REDACTED]");
    // 普通文本不受影响
    expect(redact("Basic setup guide for a Bearer of bad news")).toBe("Basic setup guide for a Bearer of bad news");
  });
});

describe("cli args", () => {
  it("defaults to stdio and parses --http/--port/--host", () => {
    expect(parseArgs([])).toMatchObject({ http: false, port: 3000, host: "127.0.0.1" });
    expect(parseArgs(["--http", "--port", "8080", "--host=0.0.0.0"])).toMatchObject({ http: true, port: 8080, host: "0.0.0.0" });
    expect(() => parseArgs(["--port"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});
