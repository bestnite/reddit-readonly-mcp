import { describe, expect, it } from "vitest";
import { SafeModeError } from "../src/client/errors.js";
import { SafeMode } from "../src/write/safe-mode.js";
import { BotDisclosure, DEFAULT_BOT_FOOTER } from "../src/write/bot-disclosure.js";
import { clock } from "./helpers.js";

function safe(level: "off" | "standard" | "strict") {
  const c = clock();
  const sleeps: number[] = [];
  const sm = new SafeMode(level, {
    now: c.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      c.advance(ms);
    },
  });
  return { sm, sleeps, clock: c };
}

const ok = async () => "done";

describe("safe mode", () => {
  it("rejects identical sequential content (case/whitespace-insensitive)", async () => {
    const { sm } = safe("standard");
    await sm.run({ action: "reply_to_post", content: "Great post!" }, ok);
    const err = await sm.run({ action: "reply_to_post", content: "  great   POST! " }, ok).catch((e) => e);
    expect(err).toBeInstanceOf(SafeModeError);
    expect(err.message).toContain("identical content");
  });

  it("rejects the same content across different subreddits", async () => {
    const { sm } = safe("standard");
    await sm.run({ action: "create_post", content: "Check out my tool", subreddit: "LocalLLaMA" }, ok);
    const err = await sm.run({ action: "create_post", content: "Check out my tool", subreddit: "MachineLearning" }, ok).catch((e) => e);
    expect(err).toBeInstanceOf(SafeModeError);
    expect(err.message).toContain("r/localllama");
    expect(err.message).toContain("Responsible Builder Policy");
  });

  it("does not record failed writes, so a fixed retry is allowed", async () => {
    const { sm } = safe("standard");
    await expect(sm.run({ action: "reply", content: "abc" }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(sm.run({ action: "reply", content: "abc" }, ok)).resolves.toBe("done");
  });

  it("enforces the minimum delay between writes (2 s standard, 5 s strict)", async () => {
    const std = safe("standard");
    await std.sm.run({ action: "a", content: "one" }, ok);
    std.clock.advance(500);
    await std.sm.run({ action: "b", content: "two" }, ok);
    expect(std.sleeps).toEqual([1500]);

    const strict = safe("strict");
    await strict.sm.run({ action: "a", content: "one" }, ok);
    await strict.sm.run({ action: "b", content: "two" }, ok);
    expect(strict.sleeps).toEqual([5000]);
  });

  it("strict mode has a lower hourly cap", async () => {
    const { sm } = safe("strict");
    for (let i = 0; i < 10; i++) await sm.run({ action: "w", content: `msg ${i}` }, ok);
    await expect(sm.run({ action: "w", content: "msg 11" }, ok)).rejects.toThrow("10 write operations per hour");
  });

  it("serialises concurrent writes so duplicates cannot race past the check", async () => {
    const { sm } = safe("standard");
    const results = await Promise.allSettled([
      sm.run({ action: "w", content: "same" }, ok),
      sm.run({ action: "w", content: "same" }, ok),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("writes without content (edits, deletes) skip the duplicate check", async () => {
    const { sm } = safe("standard");
    await sm.run({ action: "edit_post" }, ok);
    await expect(sm.run({ action: "edit_post" }, ok)).resolves.toBe("done");
  });

  it("off mode applies no guards", async () => {
    const { sm, sleeps } = safe("off");
    await sm.run({ action: "w", content: "x", subreddit: "a" }, ok);
    await sm.run({ action: "w", content: "x", subreddit: "b" }, ok);
    expect(sleeps).toEqual([]);
  });
});

describe("bot disclosure", () => {
  it("appends the footer only when enabled, and only once", () => {
    expect(new BotDisclosure(false).apply("hi")).toBe("hi");
    const on = new BotDisclosure(true);
    const once = on.apply("hi");
    expect(once).toBe(`hi${DEFAULT_BOT_FOOTER}`);
    expect(on.apply(once)).toBe(once);
    expect(new BotDisclosure(true, "I am a bot").apply("hi")).toBe("hi\n\nI am a bot");
  });
});
