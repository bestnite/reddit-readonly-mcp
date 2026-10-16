// 构建 McpServer 并注册全部工具。每个 MCP 会话一个 McpServer，但共享同一个 AppContext。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./config.js";
import type { AppContext } from "./context.js";
import { SERVER_INSTRUCTIONS } from "./messages.js";
import { registerTools } from "./tools/index.js";

export function buildServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, ctx);
  return server;
}
