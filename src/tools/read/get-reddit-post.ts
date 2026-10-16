import { z } from "zod";
import { HttpError } from "../../client/errors.js";
import { LIMITS, trimPost } from "../../client/shape.js";
import { P } from "../../messages.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizePostId, normalizeSubreddit, TTL } from "../helpers.js";

export default readTool(
  "get_reddit_post",
  "Get Reddit Post",
  {
    post_id: z.string().describe(P.postId),
    subreddit: z.string().optional().describe(`Optional. ${P.subreddit}`),
  },
  async (args, ctx) => {
    const id = normalizePostId(args.post_id);
    const sub = args.subreddit ? normalizeSubreddit(args.subreddit) : undefined;
    const path = sub ? `/r/${sub}/comments/${id}` : `/comments/${id}`;
    const res = await ctx.client.read<[RedditListing, RedditListing]>(
      path,
      { limit: 1, depth: 1 },
      { what: `post ${id}`, cacheTtlMs: TTL.post },
    );
    const thing = res?.[0]?.data?.children?.[0];
    if (!thing || thing.kind !== "t3") throw new HttpError(404, `post ${id}`);
    return trimPost(thing.data, LIMITS.postSelftext);
  },
);
