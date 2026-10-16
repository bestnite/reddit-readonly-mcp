import { toPage, trimThing } from "../../client/shape.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { zAfter, zLimit } from "../helpers.js";

export default readTool("get_my_overview", "Get My Overview", { limit: zLimit(25), after: zAfter() }, async (args, ctx) => {
  ctx.userAuth.assertConfigured("get_my_overview");
  const user = ctx.userAuth.username as string;
  const listing = await ctx.client.user<RedditListing>(`/user/${encodeURIComponent(user)}/overview`, {
    what: "your overview",
    tool: "get_my_overview",
    query: { limit: args.limit, after: args.after },
  });
  return toPage(listing, trimThing);
});
