import { toPage, trimPost } from "../../client/shape.js";
import type { RedditListing } from "../../types.js";
import { readTool } from "../define.js";
import { normalizeUsername, TTL } from "../helpers.js";
import { userListingShape } from "./_user-listing.js";

export default readTool("get_user_posts", "Get User Posts", userListingShape, async (args, ctx) => {
  const name = normalizeUsername(args.username);
  const timed = args.sort === "top" || args.sort === "controversial";
  const listing = await ctx.client.read<RedditListing>(
    `/user/${name}/submitted`,
    { sort: args.sort, t: timed ? args.time_filter : undefined, limit: args.limit, after: args.after },
    { what: `posts of u/${name}`, cacheTtlMs: TTL.listing },
  );
  return toPage(listing, (t) => (t.kind === "t3" ? trimPost(t.data) : null));
});
