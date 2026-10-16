// 工具层共用的参数片段、名称规范化与缓存时长。

import { z } from "zod";
import { ToolInputError } from "../client/errors.js";
import { E, P } from "../messages.js";

export const TTL = {
  listing: 60_000,
  post: 60_000,
  about: 300_000,
  rules: 600_000,
  none: 0,
} as const;

export const TIME_FILTERS = ["hour", "day", "week", "month", "year", "all"] as const;
export type TimeFilter = (typeof TIME_FILTERS)[number];

export const zLimit = (def: number, max = 100) =>
  z.number().int().min(1).max(max).default(def).describe(P.limit(def, max));
export const zAfter = () => z.string().optional().describe(P.after);
export const zTimeFilter = (def: TimeFilter) => z.enum(TIME_FILTERS).default(def).describe(P.timeFilter);

// 允许 "r/foo"、"/r/foo"、"https://www.reddit.com/r/foo/" 等写法；多版块用 "a+b"
export function normalizeSubreddit(input: string): string {
  let v = input.trim();
  const url = /reddit\.com\/r\/([^/?#]+)/i.exec(v);
  if (url?.[1]) v = url[1];
  v = v.replace(/^\/?r\//i, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9_+]{2,100}$/.test(v)) throw new ToolInputError(E.invalidSubreddit(input));
  return v;
}

export function normalizeUsername(input: string): string {
  let v = input.trim();
  const url = /reddit\.com\/(?:u|user)\/([^/?#]+)/i.exec(v);
  if (url?.[1]) v = url[1];
  v = v.replace(/^\/?(u|user)\//i, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(v)) throw new ToolInputError(E.invalidUsername(input));
  return v;
}

// 帖子 id：base36、t3_ 全名或永久链接
export function normalizePostId(input: string): string {
  const v = input.trim();
  const url = /\/comments\/([a-z0-9]+)/i.exec(v) ?? /redd\.it\/([a-z0-9]+)/i.exec(v);
  const id = (url?.[1] ?? v).replace(/^t3_/i, "");
  if (!/^[a-z0-9]{1,16}$/i.test(id)) throw new ToolInputError(E.invalidId(input, "post"));
  return id.toLowerCase();
}

export function normalizeCommentId(input: string): string {
  const id = input.trim().replace(/^t1_/i, "");
  if (!/^[a-z0-9]{1,16}$/i.test(id)) throw new ToolInputError(E.invalidId(input, "comment"));
  return id.toLowerCase();
}

// 带前缀的 thing 全名；没有前缀时补上 defaultPrefix
export function normalizeFullname(input: string, defaultPrefix: "t1" | "t3", allowed: Array<"t1" | "t3">): string {
  const v = input.trim();
  const m = /^(t[13])_([a-z0-9]{1,16})$/i.exec(v);
  if (m?.[1] && m[2]) {
    const prefix = m[1].toLowerCase() as "t1" | "t3";
    if (!allowed.includes(prefix)) throw new ToolInputError(E.invalidId(input, allowed.join("/")));
    return `${prefix}_${m[2].toLowerCase()}`;
  }
  const bare = defaultPrefix === "t3" ? normalizePostId(v) : normalizeCommentId(v);
  return `${defaultPrefix}_${bare}`;
}
