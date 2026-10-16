// 命令行入口：默认 stdio；--http [--port 3000] [--host 127.0.0.1] 启动 Streamable HTTP。

import { loadConfig, PACKAGE_NAME, PACKAGE_VERSION } from "./config.js";
import { createContext } from "./context.js";
import { createLogger } from "./logger.js";
import { startStdio } from "./transport/stdio.js";
import { startHttp } from "./transport/http.js";
import { parseArgs, type CliArgs } from "./cli-args.js";

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION} - Reddit MCP server

Usage:
  reddit-mcp                       stdio transport (default)
  reddit-mcp --http [--port 3000] [--host 127.0.0.1]
                                   Streamable HTTP transport on /mcp (+ GET /health)
  reddit-mcp --help | --version

Configuration is read from environment variables (REDDIT_AUTH_MODE, REDDIT_CLIENT_ID, ...); see README.md.
`;

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  // --help / --version 不是协议消息，同样写到 stderr，保证 stdout 干净
  if (args.help) {
    process.stderr.write(HELP);
    return;
  }
  if (args.version) {
    process.stderr.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  const { config, problems } = loadConfig();
  const logger = createLogger(config.logLevel);
  for (const p of problems) logger.warn(`Config: ${p}`);
  const ctx = createContext(config, { logger });
  logger.info(
    `Starting ${PACKAGE_NAME} ${PACKAGE_VERSION} (auth mode: ${config.authMode}, safe mode: ${config.safeMode}, ` +
      `write tools: ${ctx.userAuth.configured ? "configured" : "not configured"})`,
  );

  if (args.http) await startHttp(ctx, { port: args.port, host: args.host });
  else await startStdio(ctx);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
