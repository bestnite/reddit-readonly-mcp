import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli-args.js";
import { loadConfig, missingWriteVars } from "../src/config.js";
import { createLogger, redact, registerSecret } from "../src/logger.js";

describe("config", () => {
  it("applies the documented defaults", () => {
    const { config, problems } = loadConfig({});
    expect(config).toMatchObject({
      authMode: "auto",
      mobileClientId: "ohXpoqrZYub1kg",
      safeMode: "standard",
      botDisclosure: false,
      cacheEnabled: true,
      cacheMaxBytes: 50 * 1024 * 1024,
      maxRetries: 3,
      timeoutMs: 20000,
    });
    expect(problems).toEqual([]);
    expect(missingWriteVars(config)).toEqual(["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"]);
  });

  it("reads overrides and reports invalid values without echoing secrets", () => {
    const { config, problems } = loadConfig({
      REDDIT_AUTH_MODE: "RSS",
      REDDIT_MOBILE_CLIENT_ID: "otherId",
      REDDIT_SAFE_MODE: "paranoid",
      REDDIT_CACHE_MAX_MB: "abc",
      REDDIT_PASSWORD: "  spaced  ",
    });
    expect(config.authMode).toBe("rss");
    expect(config.mobileClientId).toBe("otherId");
    expect(config.safeMode).toBe("standard");
    expect(config.password).toBe("  spaced  ");
    expect(problems).toHaveLength(2);
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
