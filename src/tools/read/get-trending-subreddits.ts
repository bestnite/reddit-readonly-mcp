import { toPage, trimSubreddit } from "../../client/shape.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { TTL, zAfter, zLimit } from "../helpers.js";

// /api/trending_subreddits 已下线（实测 404）；与 reddit-mcp-server 一样使用 /subreddits/popular
export default readTool(
  "get_trending_subreddits",
  "Get Trending Subreddits",
  { limit: zLimit(10), after: zAfter() },
  async (args, ctx) => {
    const listing = await ctx.client.read<RedditListing>(
      "/subreddits/popular",
      { limit: args.limit, after: args.after },
      { what: "popular subreddits", cacheTtlMs: TTL.about },
    );
    return toPage(listing, (t) => (t.kind === "t5" ? trimSubreddit(t.data) : null));
  },
);
