import { z } from "zod";
import { trimSubreddit } from "../../client/shape.js";
import { P } from "../../messages.js";
import type { RedditThing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, TTL } from "../helpers.js";

export default readTool(
  "get_subreddit_info",
  "Get Subreddit Info",
  { subreddit_name: z.string().describe(P.subredditName) },
  async (args, ctx) => {
    const sub = normalizeSubreddit(args.subreddit_name);
    const res = await ctx.client.read<RedditThing>(`/r/${sub}/about`, {}, { what: `r/${sub}`, cacheTtlMs: TTL.about });
    return trimSubreddit(res.data, true);
  },
);
