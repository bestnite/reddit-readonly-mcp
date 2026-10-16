import { z } from "zod";
import { P } from "../../messages.js";
import { writeTool } from "../define.js";
import { normalizeFullname } from "../helpers.js";
import { editUserText } from "./_edit.js";

export default writeTool(
  "edit_comment",
  "Edit Comment",
  { thing_id: z.string().describe(P.thingIdComment), new_text: z.string().min(1).describe(P.newText) },
  async (args, ctx) => editUserText(ctx, "edit_comment", normalizeFullname(args.thing_id, "t1", ["t1"]), args.new_text),
  { idempotentHint: true },
);
