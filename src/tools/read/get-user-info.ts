import { z } from "zod";
import { trimUser } from "../../client/shape.js";
import { P } from "../../messages.js";
import type { RedditThing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeUsername, TTL } from "../helpers.js";

export default readTool(
  "get_user_info",
  "Get User Info",
  { username: z.string().describe(P.username) },
  async (args, ctx) => {
    const name = normalizeUsername(args.username);
    const res = await ctx.client.read<RedditThing>(`/user/${name}/about`, {}, { what: `u/${name}`, cacheTtlMs: TTL.about });
    return trimUser(res.data);
  },
);
