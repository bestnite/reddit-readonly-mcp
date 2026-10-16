import { z } from "zod";
import { trimRule } from "../../client/shape.js";
import { P } from "../../messages.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, TTL } from "../helpers.js";

interface RulesResponse {
  rules?: Record<string, unknown>[];
}

export default readTool(
  "get_subreddit_rules",
  "Get Subreddit Rules",
  { subreddit_name: z.string().describe(P.subredditName) },
  async (args, ctx) => {
    const sub = normalizeSubreddit(args.subreddit_name);
    const res = await ctx.client.read<RulesResponse>(`/r/${sub}/about/rules`, {}, { what: `rules of r/${sub}`, cacheTtlMs: TTL.rules });
    return { subreddit: sub, data: (res.rules ?? []).map(trimRule), after: null };
  },
);
