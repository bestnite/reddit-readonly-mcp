// 帖子列表类工具共用：API 读取 + rss 后端回退。

import type { AppContext } from "../../context.js";
import { AuthBackendError, HttpError, RssModeActiveError, ToolInputError } from "../../client/errors.js";
import type { RssSort } from "../../client/rss.js";
import { toPage, trimPost } from "../../client/shape.js";
import { E } from "../../messages.js";
import type { Page, RedditListing, TrimmedPost } from "../../types.js";
import type { Query } from "../../client/reddit-client.js";
import { TTL } from "../helpers.js";

export async function readPostListing(ctx: AppContext, path: string, query: Query, what: string): Promise<Page<TrimmedPost>> {
  const listing = await ctx.client.read<RedditListing>(path, query, { what, cacheTtlMs: TTL.listing });
  return { ...toPage(listing, (t) => (t.kind === "t3" ? trimPost(t.data) : null)), source: "api" };
}

export interface RssFallbackRequest {
  subreddit?: string;
  sort: string;
  timeFilter?: string;
  limit: number;
  after?: string;
}

// 先走 API；若当前处于 rss 后端，则改用 RSS
export async function withRssFallback(
  ctx: AppContext,
  api: () => Promise<Page<TrimmedPost>>,
  req: RssFallbackRequest,
): Promise<Page<TrimmedPost>> {
  try {
    return await api();
  } catch (err) {
    if (!(err instanceof RssModeActiveError)) throw err;
  }
  if (!["hot", "new", "top", "rising"].includes(req.sort)) throw new ToolInputError(E.rssSortUnsupported(req.sort));
  if (req.after) throw new ToolInputError(E.rssPaginationUnsupported);
  try {
    const data = await ctx.rss.listing(req.subreddit, req.sort as RssSort, req.timeFilter, req.limit);
    return {
      data,
      after: null,
      source: "rss",
      note: "RSS fallback backend: score, num_comments and pagination are unavailable (max ~25 entries).",
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new AuthBackendError("rss", detail, ctx.tokens.mode === "rss");
  }
}
