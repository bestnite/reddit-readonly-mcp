import { z } from "zod";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeFullname } from "../helpers.js";
import { performWrite } from "./_write.js";

export default writeTool(
  "delete_post",
  "Delete Post (permanent)",
  { thing_id: z.string().describe(P.thingIdPost) },
  async (args, ctx) => {
    const id = normalizeFullname(args.thing_id, "t3", ["t3"]);
    await performWrite(ctx, "delete_post", { action: "delete_post" }, "/api/del", { id });
    return { ok: true, deleted: id, permanent: true };
  },
  { destructiveHint: true, idempotentHint: true },
);
