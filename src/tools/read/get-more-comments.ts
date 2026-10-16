import { z } from "zod";
import { HttpError, RssModeActiveError, ToolInputError } from "../../client/errors.js";
import { flattenMoreChildren } from "../../client/shape.js";
import { E, P } from "../../messages.js";
import type { RedditThing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeCommentId, normalizePostId } from "../helpers.js";
import { COMMENT_SORTS } from "./get-post-comments.js";

interface MoreChildrenResponse {
  json?: { data?: { things?: RedditThing[] } };
}

// 实测（2026-10）匿名 token 访问 /api/morechildren 一律 403；配置了用户凭据时用用户 token 重试同一接口
export default readTool(
  "get_more_comments",
  "Get More Comments",
  {
    link_id: z.string().describe(P.linkId),
    comment_ids: z.array(z.string()).min(1).max(100).describe(P.commentIds),
    sort: z.enum(COMMENT_SORTS).default("confidence").describe(P.commentSort),
  },
  async (args, ctx) => {
    const linkId = `t3_${normalizePostId(args.link_id)}`;
    const children = args.comment_ids.map(normalizeCommentId).join(",");
    const sort = args.sort === "best" ? "confidence" : args.sort;
    const query = { api_type: "json", link_id: linkId, children, sort, limit_children: false };
    const what = `more comments of ${linkId}`;

    let res: MoreChildrenResponse;
    try {
      res = await ctx.client.read<MoreChildrenResponse>("/api/morechildren", query, { what, cacheTtlMs: 0 });
    } catch (err) {
      const blocked = (err instanceof HttpError && err.status === 403) || err instanceof RssModeActiveError;
      if (!blocked) throw err;
      if (!ctx.userAuth.configured) {
        if (err instanceof RssModeActiveError) throw err;
        throw new ToolInputError(E.forbiddenAnonymous("/api/morechildren"));
      }
      ctx.logger.info("Anonymous /api/morechildren refused; retrying with the user token");
      res = await ctx.client.user<MoreChildrenResponse>("/api/morechildren", { what, tool: "get_more_comments", query });
    }
    const { comments, more } = flattenMoreChildren(res.json?.data?.things ?? []);
    return { link_id: linkId, data: comments, more, after: null };
  },
);
