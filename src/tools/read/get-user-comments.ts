import { toPage, trimComment } from "../../client/shape.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeUsername, TTL } from "../helpers.js";
import { userListingShape } from "./_user-listing.js";

export default readTool("get_user_comments", "Get User Comments", userListingShape, async (args, ctx) => {
  const name = normalizeUsername(args.username);
  const timed = args.sort === "top" || args.sort === "controversial";
  const listing = await ctx.client.read<RedditListing>(
    `/user/${name}/comments`,
    { sort: args.sort, t: timed ? args.time_filter : undefined, limit: args.limit, after: args.after },
    { what: `comments of u/${name}`, cacheTtlMs: TTL.listing },
  );
  return toPage(listing, (t) => (t.kind === "t1" ? trimComment(t.data) : null));
});
