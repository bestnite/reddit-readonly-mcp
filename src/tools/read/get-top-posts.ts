import { z } from "zod";
import { P } from "../../messages.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, zAfter, zLimit, zTimeFilter } from "../helpers.js";
import { readPostListing, withRssFallback } from "./_posts.js";

export default readTool(
  "get_top_posts",
  "Get Top Posts",
  {
    subreddit: z.string().optional().describe(P.subredditOptional),
    time_filter: zTimeFilter("week"),
    limit: zLimit(10),
    after: zAfter(),
  },
  async (args, ctx) => {
    const sub = args.subreddit ? normalizeSubreddit(args.subreddit) : undefined;
    const path = sub ? `/r/${sub}/top` : "/top";
    return withRssFallback(
      ctx,
      () => readPostListing(ctx, path, { t: args.time_filter, limit: args.limit, after: args.after }, sub ? `r/${sub}` : "front page"),
      { subreddit: sub, sort: "top", timeFilter: args.time_filter, limit: args.limit, after: args.after },
    );
  },
  { rssCapable: true },
);
