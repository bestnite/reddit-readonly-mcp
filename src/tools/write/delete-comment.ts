import { z } from "zod";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeFullname } from "../helpers.js";
import { performWrite } from "./_write.js";

export default writeTool(
  "delete_comment",
  "Delete Comment (permanent)",
  { thing_id: z.string().describe(P.thingIdComment) },
  async (args, ctx) => {
    const id = normalizeFullname(args.thing_id, "t1", ["t1"]);
    await performWrite(ctx, "delete_comment", { action: "delete_comment" }, "/api/del", { id });
    return { ok: true, deleted: id, permanent: true };
  },
  { destructiveHint: true, idempotentHint: true },
);
