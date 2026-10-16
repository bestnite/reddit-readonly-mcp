// 工具注册表：统一包装 handler，把结果序列化为 JSON 文本，把错误转换成 isError 结果。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../context.js";
import { RssModeActiveError, RssUnsupportedError, toToolErrorText } from "../client/errors.js";
import { redact } from "../logger.js";
import type { ToolDef } from "./define.js";

import getRedditPost from "./read/get-reddit-post.js";
import getTopPosts from "./read/get-top-posts.js";
import browseSubreddit from "./read/browse-subreddit.js";
import searchReddit from "./read/search-reddit.js";
import getUserInfo from "./read/get-user-info.js";
import getUserPosts from "./read/get-user-posts.js";
import getUserComments from "./read/get-user-comments.js";
import getSubredditInfo from "./read/get-subreddit-info.js";
import getSubredditRules from "./read/get-subreddit-rules.js";
import getTrendingSubreddits from "./read/get-trending-subreddits.js";
import getPostComments from "./read/get-post-comments.js";
import getMoreComments from "./read/get-more-comments.js";
import getPostFlairs from "./read/get-post-flairs.js";
import getMe from "./read/get-me.js";
import getMyOverview from "./read/get-my-overview.js";
import getMySaved from "./read/get-my-saved.js";
import createPost from "./write/create-post.js";
import replyToPost from "./write/reply-to-post.js";
import editPost from "./write/edit-post.js";
import editComment from "./write/edit-comment.js";
import deletePost from "./write/delete-post.js";
import deleteComment from "./write/delete-comment.js";
import doctor from "./doctor.js";

// 各工具 schema 各不相同，注册表只关心统一的外形
export const ALL_TOOLS: ToolDef<any>[] = [
  getRedditPost,
  getTopPosts,
  browseSubreddit,
  searchReddit,
  getUserInfo,
  getUserPosts,
  getUserComments,
  getSubredditInfo,
  getSubredditRules,
  getTrendingSubreddits,
  getPostComments,
  getMoreComments,
  getPostFlairs,
  getMe,
  getMyOverview,
  getMySaved,
  createPost,
  replyToPost,
  editPost,
  editComment,
  deletePost,
  deleteComment,
  doctor,
];

// 执行一个工具并生成 MCP 结果（也供 smoke 脚本直接调用）
export async function runTool(tool: ToolDef<any>, args: unknown, ctx: AppContext): Promise<CallToolResult> {
  try {
    const result = await tool.handler(args as never, ctx);
    return { content: [{ type: "text", text: redact(JSON.stringify(result, null, 2)) }] };
  } catch (err) {
    const e = err instanceof RssModeActiveError ? new RssUnsupportedError(tool.name) : err;
    const text = toToolErrorText(e);
    ctx.logger.warn(`Tool ${tool.name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { content: [{ type: "text", text }], isError: true };
  }
}

export function registerTools(server: McpServer, ctx: AppContext): void {
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown) => runTool(tool, args, ctx),
    );
  }
}
