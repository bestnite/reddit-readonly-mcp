import { z } from "zod";
import { trimComment } from "../../client/shape.js";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeFullname } from "../helpers.js";
import { performWrite } from "./_write.js";

export default writeTool(
  "reply_to_post",
  "Reply To Post Or Comment",
  {
    post_id: z.string().describe(P.replyParent),
    content: z.string().min(1).describe(P.replyContent),
  },
  async (args, ctx) => {
    const parent = normalizeFullname(args.post_id, "t3", ["t1", "t3"]);
    const res = await performWrite(
      ctx,
      "reply_to_post",
      { action: "reply_to_post", content: args.content },
      "/api/comment",
      { thing_id: parent, text: ctx.disclosure.apply(args.content) },
    );
    const thing = res.json?.data?.things?.[0];
    return {
      ok: true,
      parent: parent,
      comment: thing && thing.kind === "t1" ? trimComment(thing.data) : null,
      bot_disclosure_appended: ctx.disclosure.enabled,
    };
  },
);
