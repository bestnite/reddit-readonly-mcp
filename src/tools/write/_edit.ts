// edit_post / edit_comment 共用：/api/editusertext
import type { AppContext } from "../../context.js";
import { trimComment, trimPost } from "../../client/shape.js";
import { performWrite } from "./_write.js";

export async function editUserText(ctx: AppContext, tool: string, fullname: string, newText: string) {
  const res = await performWrite(
    ctx,
    tool,
    { action: tool, content: newText },
    "/api/editusertext",
    { thing_id: fullname, text: ctx.disclosure.apply(newText) },
  );
  const thing = res.json?.data?.things?.[0];
  let item: unknown = null;
  if (thing?.kind === "t1") item = trimComment(thing.data);
  else if (thing?.kind === "t3") item = trimPost(thing.data);
  return { ok: true, thing_id: fullname, updated: item, bot_disclosure_appended: ctx.disclosure.enabled };
}
