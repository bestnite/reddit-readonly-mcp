// 裁剪后的响应类型：只保留 agent 需要的字段，绝不透传 Reddit 原始的大块 JSON。

export interface Page<T> {
  data: T[];
  after: string | null;
  // RSS 模式下附带说明（无分数 / 评论数 / 分页）
  note?: string;
  source?: "api" | "rss";
}

export interface TrimmedPost {
  kind?: "post";
  id: string;
  fullname: string;
  title: string;
  author: string;
  subreddit: string;
  score: number | null;
  upvote_ratio?: number | null;
  num_comments: number | null;
  created_utc: string;
  permalink: string;
  url: string;
  is_self: boolean;
  flair?: string | null;
  nsfw?: boolean;
  stickied?: boolean;
  locked?: boolean;
  selftext?: string;
  selftext_truncated?: boolean;
}

export interface TrimmedComment {
  kind?: "comment";
  id: string;
  fullname: string;
  author: string;
  body: string;
  body_truncated?: boolean;
  score: number | null;
  created_utc: string;
  permalink: string;
  parent_id: string;
  link_id?: string;
  subreddit?: string;
  link_title?: string;
  depth?: number;
  is_submitter?: boolean;
  stickied?: boolean;
  // 该评论下被折叠的回复数量（本服务器无法展开：/api/morechildren 对匿名 token 返回 403）
  more_replies?: number;
  replies?: TrimmedComment[];
}

export interface MoreStub {
  parent_id: string;
  count: number;
  // 被折叠的评论 id（仅供参考，无法通过本服务器展开）
  children: string[];
  depth?: number;
  // "continue this thread" 类型的桩：children 为空，需要单独打开该评论的永久链接
  continue_thread?: boolean;
}

export interface TrimmedUser {
  kind?: "user";
  name: string;
  id?: string;
  fullname?: string;
  created_utc?: string;
  link_karma?: number;
  comment_karma?: number;
  total_karma?: number;
  is_employee?: boolean;
  is_mod?: boolean;
  is_gold?: boolean;
  verified?: boolean;
  has_verified_email?: boolean;
  is_suspended?: boolean;
  icon_img?: string;
  description?: string;
  profile_url?: string;
}

export interface TrimmedSubreddit {
  kind?: "subreddit";
  name: string;
  fullname: string;
  title: string;
  public_description: string;
  subscribers: number | null;
  active_users: number | null;
  created_utc: string;
  nsfw: boolean;
  subreddit_type: string;
  submission_type?: string | null;
  url: string;
  lang?: string;
  description?: string;
  description_truncated?: boolean;
}

export interface TrimmedRule {
  priority: number;
  short_name: string;
  description: string;
  kind: string;
  violation_reason?: string;
}

// Reddit 原始结构（只声明用到的字段）
export interface RedditThing<T = Record<string, unknown>> {
  kind: string;
  data: T;
}

export interface RedditListing<T = Record<string, unknown>> {
  kind: "Listing";
  data: {
    after: string | null;
    before?: string | null;
    children: RedditThing<T>[];
  };
}
