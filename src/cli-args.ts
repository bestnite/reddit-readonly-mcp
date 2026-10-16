// 命令行参数解析（独立成模块，便于单元测试）。

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
