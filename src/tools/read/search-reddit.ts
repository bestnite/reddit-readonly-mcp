import { z } from "zod";
import { ToolInputError } from "../../client/errors.js";
import { toPage, trimPost, trimSubreddit, trimUser } from "../../client/shape.js";
import { E, P } from "../../messages.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, TTL, zAfter, zLimit, zTimeFilter } from "../helpers.js";

export default readTool(
  "search_reddit",
  "Search Reddit",
  {
    query: z.string().optional().describe(P.searchQuery),
    q: z.string().optional().describe(P.searchQueryAlias),
    subreddit: z.string().optional().describe(P.searchSubreddit),
    sort: z.enum(["relevance", "hot", "top", "new", "comments"]).default("relevance").describe(P.searchSort),
    time_filter: zTimeFilter("all"),
    type: z.enum(["link", "sr", "user"]).default("link").describe(P.searchType),
    limit: zLimit(10),
    after: zAfter(),
  },
  async (args, ctx) => {
    const q = (args.query ?? args.q ?? "").trim();
    if (q === "") throw new ToolInputError(E.searchQueryMissing);
    const sub = args.subreddit ? normalizeSubreddit(args.subreddit) : undefined;
    const path = sub ? `/r/${sub}/search` : "/search";
    const listing = await ctx.client.read<RedditListing>(
      path,
      {
        q,
        restrict_sr: sub ? 1 : undefined,
        sort: args.sort,
        t: args.time_filter,
        type: args.type,
        limit: args.limit,
        after: args.after,
      },
      { what: sub ? `search in r/${sub}` : "search", cacheTtlMs: TTL.listing },
    );
    return toPage(listing, (t) => {
      if (t.kind === "t3") return trimPost(t.data);
      if (t.kind === "t5") return trimSubreddit(t.data);
      if (t.kind === "t2") return trimUser(t.data);
      return null;
    });
  },
);
