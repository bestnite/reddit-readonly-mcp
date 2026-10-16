import { z } from "zod";
import { HttpError } from "../../client/errors.js";
import { buildCommentTree, trimPost } from "../../client/shape.js";
import { P } from "../../messages.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizePostId, normalizeSubreddit, TTL } from "../helpers.js";

export const COMMENT_SORTS = ["confidence", "best", "top", "new", "controversial", "old", "qa"] as const;

export default readTool(
  "get_post_comments",
  "Get Post Comments",
  {
    post_id: z.string().describe(P.postId),
    subreddit: z.string().optional().describe(`Optional. ${P.subreddit}`),
    sort: z.enum(COMMENT_SORTS).default("confidence").describe(P.commentSort),
    limit: z.number().int().min(1).max(500).default(100).describe(P.commentLimit),
    depth: z.number().int().min(1).max(10).default(5).describe(P.commentDepth),
  },
  async (args, ctx) => {
    const id = normalizePostId(args.post_id);
    const sub = args.subreddit ? normalizeSubreddit(args.subreddit) : undefined;
    const path = sub ? `/r/${sub}/comments/${id}` : `/comments/${id}`;
    const sort = args.sort === "best" ? "confidence" : args.sort;
    const res = await ctx.client.read<[RedditListing, RedditListing]>(
      path,
      { sort, limit: args.limit, depth: args.depth },
      { what: `comments of post ${id}`, cacheTtlMs: TTL.post },
    );
    const postThing = res?.[0]?.data?.children?.[0];
    if (!postThing || postThing.kind !== "t3") throw new HttpError(404, `post ${id}`);
    const tree = buildCommentTree(res[1]?.data?.children ?? []);
    return { post: trimPost(postThing.data), data: tree.comments, more: tree.more, comment_count_returned: tree.total, after: null };
  },
);
