// stdio 传输：stdout 只输出 MCP 协议消息，日志全部走 stderr。

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppContext } from "../context.js";
import { buildServer } from "../server.js";

export async function startStdio(ctx: AppContext): Promise<void> {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  ctx.logger.info("reddit-mcp listening on stdio");
  const shutdown = async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
