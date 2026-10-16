// 工具定义的统一形状：名称、描述来自 messages.ts，handler 返回可 JSON 序列化的结果。

import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../context.js";
import type { ToolName } from "../messages.js";
import { TOOL_DESCRIPTIONS } from "../messages.js";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  // 是否能在 rss 后端下工作（只有 browse_subreddit / get_top_posts）
  rssCapable?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: AppContext) => Promise<unknown>;
}

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

export function readTool<S extends z.ZodRawShape>(
  name: ToolName,
  title: string,
  inputSchema: S,
  handler: ToolDef<S>["handler"],
  extra: Partial<Pick<ToolDef<S>, "rssCapable">> = {},
): ToolDef<S> {
  return { name, title, description: TOOL_DESCRIPTIONS[name], inputSchema, annotations: { ...READ, title }, handler, ...extra };
}
