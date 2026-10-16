// edit_post / edit_comment 共用：/api/editusertext
import type { AppContext } from "../../context.js";
import { trimComment, trimPost } from "../../client/shape.js";
import { performWrite } from "./_write.js";

export async function editUserText(ctx: AppContext, tool: string, fullname: string, newText: string) {
  const res = await performWrite(
    ctx,
    tool,
    // 编辑不做重复检测：同一文本重复编辑是幂等的，改回旧文本也是正当操作；仍受写入间隔与每小时上限约束
    { action: tool },
    "/api/editusertext",
    { thing_id: fullname, text: ctx.disclosure.apply(newText) },
  );
  const thing = res.json?.data?.things?.[0];
  let item: unknown = null;
  if (thing?.kind === "t1") item = trimComment(thing.data);
  else if (thing?.kind === "t3") item = trimPost(thing.data);
  return { ok: true, thing_id: fullname, updated: item, bot_disclosure_appended: ctx.disclosure.enabled };
}
