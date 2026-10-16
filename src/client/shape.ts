// 把 Reddit 原始 JSON 裁剪成精简结构（types.ts）。

import type {
  MoreStub,
  Page,
  RedditListing,
  RedditThing,
  TrimmedComment,
  TrimmedFlair,
  TrimmedPost,
  TrimmedRule,
  TrimmedSubreddit,
  TrimmedUser,
} from "../types.js";

export const LIMITS = {
  listingSelftext: 800,
  postSelftext: 10_000,
  commentBody: 1_500,
  subredditDescription: 2_000,
  ruleDescription: 1_000,
} as const;

type Raw = Record<string, unknown>;

const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const b = (v: unknown): boolean => v === true;

export function isoFromUtc(v: unknown): string {
  const secs = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(secs)) return "";
  return new Date(secs * 1000).toISOString();
}

// 截断长文本；返回 [文本, 是否截断]
export function truncate(text: string, max: number): [string, boolean] {
  if (text.length <= max) return [text, false];
  return [`${text.slice(0, max)} …[truncated, ${text.length} chars total]`, true];
}

export function absolutePermalink(p: unknown): string {
  const v = s(p);
  if (v === "") return "";
  return v.startsWith("http") ? v : `https://www.reddit.com${v}`;
}

export function trimPost(d: Raw, selftextMax: number = LIMITS.listingSelftext): TrimmedPost {
  const id = s(d.id);
  const post: TrimmedPost = {
    id,
    fullname: s(d.name, id ? `t3_${id}` : ""),
    title: s(d.title),
    author: s(d.author, "[deleted]"),
    subreddit: s(d.subreddit),
    score: n(d.score),
    upvote_ratio: n(d.upvote_ratio),
    num_comments: n(d.num_comments),
    created_utc: isoFromUtc(d.created_utc),
    permalink: absolutePermalink(d.permalink),
    url: s(d.url_overridden_by_dest, s(d.url)),
    is_self: b(d.is_self),
    flair: typeof d.link_flair_text === "string" && d.link_flair_text !== "" ? d.link_flair_text : null,
  };
  if (b(d.over_18)) post.nsfw = true;
  if (b(d.stickied)) post.stickied = true;
  if (b(d.locked)) post.locked = true;
  const text = s(d.selftext);
  if (text !== "") {
    const [t, cut] = truncate(text, selftextMax);
    post.selftext = t;
    if (cut) post.selftext_truncated = true;
  }
  return post;
}

export function trimComment(d: Raw, bodyMax: number = LIMITS.commentBody): TrimmedComment {
  const id = s(d.id);
  const [body, cut] = truncate(s(d.body), bodyMax);
  const c: TrimmedComment = {
    id,
    fullname: s(d.name, id ? `t1_${id}` : ""),
    author: s(d.author, "[deleted]"),
    body,
    score: n(d.score),
    created_utc: isoFromUtc(d.created_utc),
    permalink: absolutePermalink(d.permalink),
    parent_id: s(d.parent_id),
  };
  if (cut) c.body_truncated = true;
  if (typeof d.link_id === "string") c.link_id = d.link_id;
  if (typeof d.subreddit === "string") c.subreddit = d.subreddit;
  if (typeof d.link_title === "string") c.link_title = d.link_title;
  if (typeof d.depth === "number") c.depth = d.depth;
  if (b(d.is_submitter)) c.is_submitter = true;
  if (b(d.stickied)) c.stickied = true;
  return c;
}

export function trimUser(d: Raw): TrimmedUser {
  const name = s(d.name);
  if (b(d.is_suspended)) return { name, is_suspended: true, profile_url: `https://www.reddit.com/user/${name}` };
  const sub = (d.subreddit ?? {}) as Raw;
  const u: TrimmedUser = {
    name,
    id: s(d.id),
    fullname: d.id ? `t2_${s(d.id)}` : "",
    created_utc: isoFromUtc(d.created_utc),
    link_karma: n(d.link_karma) ?? 0,
    comment_karma: n(d.comment_karma) ?? 0,
    total_karma: n(d.total_karma) ?? (n(d.link_karma) ?? 0) + (n(d.comment_karma) ?? 0),
    is_employee: b(d.is_employee),
    is_mod: b(d.is_mod),
    is_gold: b(d.is_gold),
    verified: b(d.verified),
    has_verified_email: b(d.has_verified_email),
    profile_url: `https://www.reddit.com/user/${name}`,
  };
  const icon = s(d.icon_img);
  if (icon) u.icon_img = icon;
  const desc = s(sub.public_description);
  if (desc) u.description = truncate(desc, 1000)[0];
  return u;
}

export function trimSubreddit(d: Raw, withDescription = false): TrimmedSubreddit {
  const name = s(d.display_name);
  const sr: TrimmedSubreddit = {
    name,
    fullname: s(d.name),
    title: s(d.title),
    public_description: s(d.public_description),
    subscribers: n(d.subscribers),
    active_users: n(d.active_user_count) ?? n(d.accounts_active),
    created_utc: isoFromUtc(d.created_utc),
    nsfw: b(d.over18),
    subreddit_type: s(d.subreddit_type),
    submission_type: typeof d.submission_type === "string" ? d.submission_type : null,
    url: absolutePermalink(d.url),
  };
  if (typeof d.lang === "string" && d.lang) sr.lang = d.lang;
  if (withDescription) {
    const [desc, cut] = truncate(s(d.description), LIMITS.subredditDescription);
    if (desc) sr.description = desc;
    if (cut) sr.description_truncated = true;
  }
  return sr;
}

export function trimRule(d: Raw): TrimmedRule {
  const r: TrimmedRule = {
    priority: n(d.priority) ?? 0,
    short_name: s(d.short_name),
    description: truncate(s(d.description), LIMITS.ruleDescription)[0],
    kind: s(d.kind, "all"),
  };
  const v = s(d.violation_reason);
  if (v && v !== r.short_name) r.violation_reason = v;
  return r;
}

export function trimFlair(d: Raw): TrimmedFlair {
  const f: TrimmedFlair = {
    id: s(d.id),
    text: s(d.text),
    text_editable: b(d.text_editable),
  };
  if (b(d.mod_only)) f.mod_only = true;
  if (typeof d.type === "string") f.type = d.type;
  if (s(d.background_color)) f.background_color = s(d.background_color);
  if (s(d.text_color)) f.text_color = s(d.text_color);
  return f;
}

// 混合类型的 listing（搜索、overview、saved）按 kind 分派
export function trimThing(t: RedditThing): TrimmedPost | TrimmedComment | TrimmedUser | TrimmedSubreddit | null {
  switch (t.kind) {
    case "t3":
      return { kind: "post", ...trimPost(t.data) };
    case "t1":
      return { kind: "comment", ...trimComment(t.data) };
    case "t2":
      return { kind: "user", ...trimUser(t.data) };
    case "t5":
      return { kind: "subreddit", ...trimSubreddit(t.data) };
    default:
      return null;
  }
}

export function toPage<T>(listing: RedditListing, map: (t: RedditThing) => T | null): Page<T> {
  const children = listing?.data?.children ?? [];
  const data: T[] = [];
  for (const c of children) {
    const v = map(c);
    if (v !== null) data.push(v);
  }
  return { data, after: listing?.data?.after ?? null };
}

export interface CommentTree {
  comments: TrimmedComment[];
  more: MoreStub[];
  total: number;
}

function moreStub(d: Raw): MoreStub {
  const children = Array.isArray(d.children) ? (d.children as unknown[]).map(String) : [];
  const stub: MoreStub = {
    parent_id: s(d.parent_id),
    count: n(d.count) ?? children.length,
    children,
  };
  if (typeof d.depth === "number") stub.depth = d.depth;
  if (children.length === 0) stub.continue_thread = true;
  return stub;
}

// 把 /comments/<id> 返回的评论树裁剪为嵌套结构；more 桩汇总到顶层列表
export function buildCommentTree(children: RedditThing[], bodyMax: number = LIMITS.commentBody): CommentTree {
  const more: MoreStub[] = [];
  let total = 0;
  const walk = (things: RedditThing[]): { comments: TrimmedComment[]; moreCount: number } => {
    const out: TrimmedComment[] = [];
    let moreCount = 0;
    for (const t of things) {
      if (t.kind === "more") {
        const stub = moreStub(t.data);
        more.push(stub);
        moreCount += stub.count;
        continue;
      }
      if (t.kind !== "t1") continue;
      total++;
      const c = trimComment(t.data, bodyMax);
      const replies = t.data.replies as RedditListing | "" | undefined;
      if (replies && typeof replies === "object") {
        const sub = walk(replies.data?.children ?? []);
        if (sub.comments.length > 0) c.replies = sub.comments;
        if (sub.moreCount > 0) c.more_replies = sub.moreCount;
      }
      out.push(c);
    }
    return { comments: out, moreCount };
  };
  const { comments } = walk(children);
  return { comments, more, total };
}

// /api/morechildren 返回扁平列表
export function flattenMoreChildren(things: RedditThing[], bodyMax: number = LIMITS.commentBody): {
  comments: TrimmedComment[];
  more: MoreStub[];
} {
  const comments: TrimmedComment[] = [];
  const more: MoreStub[] = [];
  for (const t of things) {
    if (t.kind === "t1") comments.push(trimComment(t.data, bodyMax));
    else if (t.kind === "more") more.push(moreStub(t.data));
  }
  return { comments, more };
}
