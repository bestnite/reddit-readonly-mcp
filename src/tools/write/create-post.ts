import { z } from "zod";
import { ToolInputError } from "../../client/errors.js";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeSubreddit } from "../helpers.js";
import { performWrite } from "./_write.js";

export default writeTool(
  "create_post",
  "Create Post",
  {
    subreddit: z.string().describe(P.subreddit),
    title: z.string().min(1).max(300).describe(P.title),
    content: z.string().describe(P.postContent),
    is_self: z.boolean().default(true).describe(P.isSelf),
    flair_id: z.string().optional().describe(P.flairId),
    flair_text: z.string().optional().describe(P.flairText),
  },
  async (args, ctx) => {
    const sub = normalizeSubreddit(args.subreddit);
    if (!args.is_self && !/^https?:\/\//i.test(args.content.trim())) {
      throw new ToolInputError("Invalid input: a link post (is_self=false) needs an http(s) URL as content.");
    }
    // 重复检测基于正文（链接帖基于 URL）；正文为空时退回标题
    const fingerprint = args.content.trim() !== "" ? args.content : args.title;
    const res = await performWrite(
      ctx,
      "create_post",
      { action: "create_post", content: fingerprint, subreddit: sub },
      "/api/submit",
      {
        sr: sub,
        title: args.title,
        kind: args.is_self ? "self" : "link",
        text: args.is_self ? ctx.disclosure.apply(args.content) : undefined,
        url: args.is_self ? undefined : args.content.trim(),
        flair_id: args.flair_id,
        flair_text: args.flair_text,
        resubmit: true,
        sendreplies: true,
      },
    );
    const d = res.json?.data ?? {};
    return {
      ok: true,
      id: d.id ?? null,
      fullname: d.name ?? (d.id ? `t3_${d.id}` : null),
      url: d.url ?? null,
      subreddit: sub,
      bot_disclosure_appended: args.is_self && ctx.disclosure.enabled,
    };
  },
);
