import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeEntities, parseRssFeed, rssUrl } from "../src/client/rss.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/localllama-hot.rss", import.meta.url)), "utf8");

describe("RSS backend", () => {
  it("parses a real Atom feed into trimmed posts without score/comment counts", () => {
    const posts = parseRssFeed(fixture);
    expect(posts).toHaveLength(2);
    const p = posts[0]!;
    expect(p).toMatchObject({
      id: "1x6r9pz",
      fullname: "t3_1x6r9pz",
      author: "AIatMeta",
      subreddit: "LocalLLaMA",
      score: null,
      num_comments: null,
      permalink: "https://www.reddit.com/r/LocalLLaMA/comments/1x6r9pz/introducing_muse_spark_open_the_most_capable_us/",
      url: "https://i.redd.it/4nv4g9cnvnvh1.png",
      is_self: false,
      created_utc: "2026-10-15T17:03:45.000Z",
    });
    expect(p.title).toContain("Muse Spark Open");
    expect(p.selftext).toBeDefined();
    expect(p.selftext).not.toMatch(/<[a-z]/i);
    expect(p.selftext).not.toContain("&amp;");
  });

  it("builds the documented feed URLs", () => {
    expect(rssUrl("LocalLLaMA", "hot")).toBe("https://www.reddit.com/r/LocalLLaMA/hot.rss");
    expect(rssUrl("LocalLLaMA", "new")).toBe("https://www.reddit.com/r/LocalLLaMA/new.rss");
    expect(rssUrl("LocalLLaMA", "top", "day")).toBe("https://www.reddit.com/r/LocalLLaMA/top.rss?t=day");
    expect(rssUrl(undefined, "hot")).toBe("https://www.reddit.com/hot.rss");
  });

  it("keeps numeric-looking titles and usernames as strings", () => {
    const xml = fixture
      .replace(/<title>Introducing[^<]*<\/title>/, "<title>007</title>")
      .replace("<name>/u/AIatMeta</name>", "<name>/u/0123</name>");
    const p = parseRssFeed(xml)[0]!;
    expect(p.title).toBe("007");
    expect(p.author).toBe("0123");
  });

  it("decodes HTML entities", () => {
    expect(decodeEntities("a &amp; b &#39;c&#39; &#x27;d&#x27; &quot;e&quot;")).toBe("a & b 'c' 'd' \"e\"");
  });
});
