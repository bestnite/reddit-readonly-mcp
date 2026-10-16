// get_user_posts / get_user_comments 共用参数
import { z } from "zod";
import { P } from "../../messages.js";
import { zAfter, zLimit, zTimeFilter } from "../helpers.js";

export const userListingShape = {
  username: z.string().describe(P.username),
  sort: z.enum(["new", "hot", "top", "controversial"]).default("new").describe(P.userSort),
  time_filter: zTimeFilter("all"),
  limit: zLimit(10),
  after: zAfter(),
};
