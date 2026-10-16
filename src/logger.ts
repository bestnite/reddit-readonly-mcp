// 日志只写 stderr：stdio 传输下 stdout 专用于 MCP 协议消息。
// 同时做一层兜底脱敏：已登记的敏感值（token、loid、session、密码等）以及
// 任何 "Bearer xxx" / "Basic xxx" 片段在输出前都会被替换。

import type { LogLevel } from "./config.js";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// 进程级敏感值登记表
const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  // 太短的值不登记，避免把普通单词误伤成 [REDACTED]
  if (value && value.length >= 6) secrets.add(value);
}

export function unregisterSecret(value: string | undefined | null): void {
  if (value) secrets.delete(value);
}

const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

export function redact(text: string): string {
  let out = text.replace(AUTH_HEADER_RE, "$1 [REDACTED]");
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(level: LogLevel = "info", write: (line: string) => void = defaultWrite): Logger {
  const threshold = LEVELS[level];
  const emit = (lvl: Exclude<LogLevel, "silent">, msg: string) => {
    if (LEVELS[lvl] < threshold) return;
    write(`${new Date().toISOString()} [reddit-mcp] ${lvl.toUpperCase()} ${redact(msg)}\n`);
  };
  return {
    debug: (m) => emit("debug", m),
    info: (m) => emit("info", m),
    warn: (m) => emit("warn", m),
    error: (m) => emit("error", m),
  };
}

function defaultWrite(line: string): void {
  process.stderr.write(line);
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
