import { z } from "zod";
import { P } from "../../messages.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, zAfter, zLimit, zTimeFilter } from "../helpers.js";
import { readPostListing, withRssFallback } from "./_posts.js";

export default readTool(
  "browse_subreddit",
  "Browse Subreddit",
  {
    subreddit: z.string().optional().describe(P.subredditOptional),
    sort: z.enum(["hot", "new", "top", "rising", "controversial"]).default("hot").describe(P.listingSort),
    time_filter: zTimeFilter("week"),
    limit: zLimit(10),
    after: zAfter(),
  },
  async (args, ctx) => {
    const sub = args.subreddit ? normalizeSubreddit(args.subreddit) : undefined;
    const path = sub ? `/r/${sub}/${args.sort}` : `/${args.sort}`;
    const timed = args.sort === "top" || args.sort === "controversial";
    return withRssFallback(
      ctx,
      () =>
        readPostListing(
          ctx,
          path,
          { t: timed ? args.time_filter : undefined, limit: args.limit, after: args.after },
          sub ? `r/${sub}/${args.sort}` : `front page /${args.sort}`,
        ),
      { subreddit: sub, sort: args.sort, timeFilter: timed ? args.time_filter : undefined, limit: args.limit, after: args.after },
    );
  },
  { rssCapable: true },
);
