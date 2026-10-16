// 命令行入口：默认 stdio；--http [--port 3000] [--host 127.0.0.1] 启动 Streamable HTTP。

import { loadConfig, PACKAGE_NAME, PACKAGE_VERSION } from "./config.js";
import { createContext } from "./context.js";
import { createLogger } from "./logger.js";
import { startStdio } from "./transport/stdio.js";
import { startHttp } from "./transport/http.js";

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION} - Reddit MCP server

Usage:
  reddit-mcp                       stdio transport (default)
  reddit-mcp --http [--port 3000] [--host 127.0.0.1]
                                   Streamable HTTP transport on /mcp (+ GET /health)
  reddit-mcp --help | --version

Configuration is read from environment variables (REDDIT_AUTH_MODE, REDDIT_CLIENT_ID, ...); see README.md.
`;

export interface CliArgs {
  http: boolean;
  port: number;
  host: string;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { http: false, port: 3000, host: "127.0.0.1", help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const [flag, inline] = a.includes("=") ? (a.split(/=(.*)/s, 2) as [string, string]) : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      return v;
    };
    switch (flag) {
      case "--http":
        args.http = true;
        break;
      case "--stdio":
        args.http = false;
        break;
      case "--port": {
        const p = Number(value());
        if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error(`Invalid --port`);
        args.port = p;
        break;
      }
      case "--host":
        args.host = value();
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

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
