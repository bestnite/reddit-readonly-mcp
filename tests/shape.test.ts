import { describe, expect, it } from "vitest";
import { buildCommentTree, LIMITS, toPage, trimPost, trimSubreddit, trimThing, trimUser } from "../src/client/shape.js";
import { listing, rawPost } from "./helpers.js";

describe("trimmed response shaping", () => {
  it("keeps only the agreed post fields", () => {
    const p = trimPost(rawPost("abc", { stickied: true, link_flair_text: "News" }).data);
    expect(p).toEqual({
      id: "abc",
      fullname: "t3_abc",
      title: "Title abc",
      author: "alice",
      subreddit: "LocalLLaMA",
      score: 42,
      upvote_ratio: 0.97,
      num_comments: 7,
      created_utc: "2025-10-09T08:53:20.000Z",
      permalink: "https://www.reddit.com/r/LocalLLaMA/comments/abc/title/",
      url: "https://www.reddit.com/r/LocalLLaMA/comments/abc/title/",
      is_self: true,
      flair: "News",
      stickied: true,
      selftext: "hello",
    });
    expect(JSON.stringify(p)).not.toContain("preview");
  });

  it("truncates long bodies and flags it", () => {
    const long = "x".repeat(LIMITS.listingSelftext + 50);
    const p = trimPost(rawPost("abc", { selftext: long }).data);
    expect(p.selftext_truncated).toBe(true);
    expect(p.selftext!.startsWith("x".repeat(LIMITS.listingSelftext))).toBe(true);
    expect(p.selftext).toContain(`${long.length} chars total`);
  });

  it("builds a {data, after} page and drops unknown kinds", () => {
    const page = toPage(listing([rawPost("a"), { kind: "t9", data: {} }, rawPost("b")], "t3_b") as any, (t) =>
      t.kind === "t3" ? trimPost(t.data) : null,
    );
    expect(page.after).toBe("t3_b");
    expect(page.data.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("nests comment replies and collects 'more' stubs", () => {
    const tree = buildCommentTree([
      {
        kind: "t1",
        data: {
          id: "c1",
          name: "t1_c1",
          author: "bob",
          body: "top",
          score: 5,
          created_utc: 1760000000,
          parent_id: "t3_p",
          depth: 0,
          permalink: "/r/x/comments/p/t/c1/",
          replies: listing([
            { kind: "t1", data: { id: "c2", body: "child", parent_id: "t1_c1", depth: 1, score: 1, created_utc: 1760000001 } },
            { kind: "more", data: { count: 3, children: ["c3", "c4", "c5"], parent_id: "t1_c1", depth: 1 } },
          ]),
        },
      },
      { kind: "more", data: { count: 12, children: ["c6", "c7"], parent_id: "t3_p", depth: 0 } },
    ] as any);
    expect(tree.total).toBe(2);
    expect(tree.comments).toHaveLength(1);
    const c1 = tree.comments[0]!;
    expect(c1.replies?.map((r) => r.id)).toEqual(["c2"]);
    expect(c1.more_replies).toBe(3);
    expect(c1.permalink).toBe("https://www.reddit.com/r/x/comments/p/t/c1/");
    expect(tree.more).toEqual([
      { parent_id: "t1_c1", count: 3, children: ["c3", "c4", "c5"], depth: 1 },
      { parent_id: "t3_p", count: 12, children: ["c6", "c7"], depth: 0 },
    ]);
  });

  it("trims users, suspended users and subreddits", () => {
    const u = trimUser({ name: "spez", id: "1w72", created_utc: 1118030400, link_karma: 10, comment_karma: 5, is_employee: true, subreddit: { public_description: "hi" } });
    expect(u).toMatchObject({ name: "spez", fullname: "t2_1w72", total_karma: 15, is_employee: true, description: "hi", created_utc: "2005-06-06T04:00:00.000Z" });
    expect(trimUser({ name: "gone", is_suspended: true })).toEqual({ name: "gone", is_suspended: true, profile_url: "https://www.reddit.com/user/gone" });
    const s = trimSubreddit({ display_name: "LocalLLaMA", name: "t5_81eyvm", title: "LocalLlama", subscribers: 100, active_user_count: 5, over18: false, url: "/r/LocalLLaMA/", created_utc: 1678000000, subreddit_type: "public" });
    expect(s).toMatchObject({ name: "LocalLLaMA", fullname: "t5_81eyvm", subscribers: 100, active_users: 5, url: "https://www.reddit.com/r/LocalLLaMA/" });
    expect(trimThing({ kind: "t3", data: rawPost("z").data })).toMatchObject({ kind: "post", id: "z" });
  });
});
