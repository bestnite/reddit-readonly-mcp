import { z } from "zod";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeFullname } from "../helpers.js";
import { editUserText } from "./_edit.js";

export default writeTool(
  "edit_post",
  "Edit Post",
  { thing_id: z.string().describe(P.thingIdPost), new_text: z.string().min(1).describe(P.newText) },
  async (args, ctx) => editUserText(ctx, "edit_post", normalizeFullname(args.thing_id, "t3", ["t3"]), args.new_text),
  { idempotentHint: true },
);
