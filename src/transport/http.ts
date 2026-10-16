// Streamable HTTP 传输：POST/GET/DELETE /mcp（有状态会话），GET /health 返回存活信息。
// 默认只监听回环地址；监听回环时校验 Host 头，防止 DNS rebinding。

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../config.js";
import type { AppContext } from "../context.js";
import { buildServer } from "../server.js";

export interface HttpOptions {
  port: number;
  host: string;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
// 客户端不发 DELETE 时，空闲超过该时长的会话会被回收
const SESSION_IDLE_MS = 30 * 60_000;

class BodyTooLargeError extends Error {}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host.startsWith("127.");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError("request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

export async function startHttp(ctx: AppContext, opts: HttpOptions): Promise<Server> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastSeen = new Map<string, number>();
  const loopback = isLoopback(opts.host);

  const sweep = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, t] of transports) {
      if ((lastSeen.get(id) ?? 0) < cutoff) {
        ctx.logger.info(`Closing idle MCP session ${id.slice(0, 8)}…`);
        transports.delete(id);
        lastSeen.delete(id);
        void t.close().catch(() => undefined);
      }
    }
  }, 60_000);
  sweep.unref();

  const hostAllowed = (req: IncomingMessage): boolean => {
    if (!loopback) return true;
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!hostAllowed(req)) {
        jsonRpcError(res, 403, -32000, "Forbidden: invalid Host header");
        return;
      }

      if (url.pathname === "/health") {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        sendJson(res, 200, {
          status: "ok",
          name: PACKAGE_NAME,
          version: PACKAGE_VERSION,
          uptime_s: Math.round((Date.now() - ctx.startedAt) / 1000),
          sessions: transports.size,
        });
        return;
      }

      if (url.pathname !== "/mcp") {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      const sid = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      if (sid && transports.has(sid)) lastSeen.set(sid, Date.now());

      if (req.method === "POST") {
        let body: unknown;
        try {
          body = await readBody(req);
        } catch (err) {
          if (err instanceof BodyTooLargeError) jsonRpcError(res, 413, -32600, "Request body too large");
          else jsonRpcError(res, 400, -32700, "Parse error");
          return;
        }
        let transport = sid ? transports.get(sid) : undefined;
        if (!transport) {
          if (sid || !isInitializeRequest(body)) {
            jsonRpcError(res, sid ? 404 : 400, -32000, sid ? "Unknown or expired session" : "Bad Request: no valid session ID");
            return;
          }
          const created = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, created);
              lastSeen.set(id, Date.now());
            },
          });
          created.onclose = () => {
            if (created.sessionId) {
              transports.delete(created.sessionId);
              lastSeen.delete(created.sessionId);
            }
          };
          await buildServer(ctx).connect(created);
          transport = created;
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sid ? transports.get(sid) : undefined;
        if (!transport) {
          jsonRpcError(res, 400, -32000, "Bad Request: no valid session ID");
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { Allow: "GET, POST, DELETE" }).end();
    } catch (err) {
      ctx.logger.error(`HTTP handler error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  ctx.logger.info(`reddit-mcp listening on http://${opts.host.includes(":") ? `[${opts.host}]` : opts.host}:${port}/mcp`);
  if (!loopback) ctx.logger.warn(`HTTP transport bound to non-loopback address ${opts.host}; there is no authentication in front of /mcp`);

  const shutdown = () => {
    clearInterval(sweep);
    for (const t of transports.values()) void t.close().catch(() => undefined);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}
