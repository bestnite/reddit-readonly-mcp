import { trimUser } from "../../client/shape.js";
import { readTool } from "../define.js";

export default readTool("get_me", "Get Me", {}, async (_args, ctx) => {
  const me = await ctx.client.user<Record<string, unknown>>("/api/v1/me", { what: "your account", tool: "get_me" });
  return trimUser(me);
});
