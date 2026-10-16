import { z } from "zod";
import { HttpError, ToolInputError } from "../../client/errors.js";
import { trimFlair } from "../../client/shape.js";
import { E, P } from "../../messages.js";
import { readTool } from "../define.js";
import { normalizeSubreddit, TTL } from "../helpers.js";

type FlairResponse = Record<string, unknown>[] | { json?: unknown };

// 匿名访问通常返回 USER_REQUIRED（或 403）；配置了用户凭据时直接用用户 token
export default readTool(
  "get_post_flairs",
  "Get Post Flairs",
  { subreddit_name: z.string().describe(P.subredditName) },
  async (args, ctx) => {
    const sub = normalizeSubreddit(args.subreddit_name);
    const path = `/r/${sub}/api/link_flair_v2`;
    const what = `link flairs of r/${sub}`;
    let res: FlairResponse;
    if (ctx.userAuth.configured) {
      res = await ctx.client.user<FlairResponse>(path, { what, tool: "get_post_flairs" });
    } else {
      try {
        res = await ctx.client.read<FlairResponse>(path, {}, { what, cacheTtlMs: TTL.rules });
      } catch (err) {
        // USER_REQUIRED 业务错误由 RedditApiError 自带的文案处理
        if (err instanceof HttpError && err.status === 403) throw new ToolInputError(E.forbiddenAnonymous(what));
        throw err;
      }
    }
    const list = Array.isArray(res) ? res : [];
    return { subreddit: sub, data: list.map(trimFlair), after: null };
  },
);
