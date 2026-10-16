// 协议层检查：启动构建产物 dist/cli.js，
//   1) stdio：发送 initialize / initialized / tools/list / tools/call(doctor) / tools/call(已删除的 create_post)，
//      确认 stdout 每一行都是 JSON-RPC 消息
//   2) HTTP：GET /health，POST /mcp initialize（拿到会话 id）→ tools/list → tools/call(doctor) → tools/call(create_post)，
//      并校验 Host 头保护
// 服务器只读：tools/list 必须恰好 12 个工具，且不含任何已删除的写工具 / 账号工具
// 用法：npm run build && npm run wire

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wire-check", version: "0.0.0" } },
};
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const DOCTOR = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "doctor", arguments: {} } };
const REMOVED_CALL = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_post", arguments: { subreddit: "test", title: "t", content: "c" } } };

const EXPECTED_TOOL_COUNT = 12;
const REMOVED_TOOLS = [
  "create_post", "reply_to_post", "edit_post", "edit_comment", "delete_post", "delete_comment",
  "get_me", "get_my_overview", "get_my_saved", "get_post_flairs", "get_more_comments",
];

function checkList(label: string, names: string[]): void {
  const leaked = names.filter((n) => REMOVED_TOOLS.includes(n));
  report(names.length === EXPECTED_TOOL_COUNT && names.includes("doctor") && leaked.length === 0, label, `${names.length} tools, removed names present: ${leaked.length ? leaked.join(", ") : "none"}`);
}

// 已删除的工具：服务器必须以"未知工具"拒绝，而不是执行
function checkRemovedCall(label: string, m: any): void {
  const text = JSON.stringify(m?.error ?? m?.result ?? null);
  const unknown = (m?.error !== undefined || m?.result?.isError === true) && /not found/i.test(text);
  report(unknown, label, text);
}

async function stdioCheck(): Promise<void> {
  const child = spawn(process.execPath, [CLI], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));

  const waitFor = async (id: number, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === id) return m;
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout waiting for response id=${id}`);
  };
  const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);

  try {
    send(INIT);
    const init = await waitFor(1);
    report(init.result?.serverInfo?.name === "reddit-readonly-mcp", "stdio initialize", `serverInfo=${JSON.stringify(init.result?.serverInfo)} protocol=${init.result?.protocolVersion}`);
    send(INITIALIZED);
    send(LIST);
    const list = await waitFor(2);
    checkList("stdio tools/list", (list.result?.tools ?? []).map((t: { name: string }) => t.name));
    send(DOCTOR);
    const doc = await waitFor(3);
    const body = JSON.parse(doc.result?.content?.[0]?.text ?? "{}");
    report(doc.result?.isError !== true && !!body.read_backend && !("write" in body), "stdio tools/call doctor", `active_backend=${body.read_backend?.active_backend} token_check=${JSON.stringify(body.read_backend?.token_check)} keys=${Object.keys(body).join(",")}`);
    send(REMOVED_CALL);
    checkRemovedCall("stdio tools/call create_post (removed)", await waitFor(4));
  } catch (err) {
    report(false, "stdio exchange", String(err));
  }
  child.stdin.end();
  await new Promise((r) => child.once("exit", r));

  // stdout 只能包含协议消息
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  const bad = lines.filter((l) => {
    try {
      return JSON.parse(l).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });
  report(bad.length === 0, "stdio stdout purity", `${lines.length} stdout lines, ${bad.length} non-JSON-RPC; ${stderr.split("\n").filter(Boolean).length} stderr log lines`);
  report(!/Bearer\s+[A-Za-z0-9]/.test(stdout + stderr), "stdio no token in output", "checked stdout+stderr for bearer tokens");
}

async function startHttp(): Promise<{ child: ChildProcessWithoutNullStreams; base: string }> {
  const child = spawn(process.execPath, [CLI, "--http", "--port", "0"], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const m = /listening on (http:\/\/[^\s]+)\/mcp/.exec(stderr);
    if (m?.[1]) {
      (child as any).getStdout = () => stdout;
      return { child, base: m[1] };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error(`HTTP server did not start: ${stderr}`);
}

// Streamable HTTP 的 POST 响应可能是 JSON，也可能是 SSE
async function readRpc(res: Response): Promise<any> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    return JSON.parse(data[data.length - 1] ?? "null");
  }
  return text ? JSON.parse(text) : null;
}

async function httpCheck(): Promise<void> {
  const { child, base } = await startHttp();
  try {
    const health = await fetch(`${base}/health`);
    const hj: any = await health.json();
    report(health.status === 200 && hj.status === "ok", "http GET /health", `${health.status} ${JSON.stringify(hj)}`);

    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const initRes = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(INIT) });
    const sid = initRes.headers.get("mcp-session-id");
    const init = await readRpc(initRes);
    report(initRes.status === 200 && !!sid && init?.result?.serverInfo?.name === "reddit-readonly-mcp", "http POST /mcp initialize", `status=${initRes.status} session=${sid ? "yes" : "no"} serverInfo=${JSON.stringify(init?.result?.serverInfo)}`);

    const sh = { ...headers, "mcp-session-id": sid ?? "", "mcp-protocol-version": init?.result?.protocolVersion ?? "2025-06-18" };
    const n = await fetch(`${base}/mcp`, { method: "POST", headers: sh, body: JSON.stringify(INITIALIZED) });
    await n.text();
    report(n.status === 202, "http notifications/initialized", `status=${n.status}`);

    const listRes = await fetch(`${base}/mcp`, { method: "POST", headers: sh, body: JSON.stringify(LIST) });
    const list = await readRpc(listRes);
    checkList("http tools/list", (list?.result?.tools ?? []).map((t: { name: string }) => t.name));

    const docRes = await fetch(`${base}/mcp`, { method: "POST", headers: sh, body: JSON.stringify(DOCTOR) });
    const doc = await readRpc(docRes);
    const body = JSON.parse(doc?.result?.content?.[0]?.text ?? "{}");
    report(doc?.result?.isError !== true && !!body.read_backend && !("write" in body), "http tools/call doctor", `active_backend=${body.read_backend?.active_backend}`);

    const rmRes = await fetch(`${base}/mcp`, { method: "POST", headers: sh, body: JSON.stringify(REMOVED_CALL) });
    checkRemovedCall("http tools/call create_post (removed)", await readRpc(rmRes));

    const noSession = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(LIST) });
    await noSession.text();
    report(noSession.status === 400, "http rejects request without session", `status=${noSession.status}`);

    // DNS rebinding 保护：伪造 Host 头（用 node:http 才能改 Host）
    const { request } = await import("node:http");
    const u = new URL(base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: u.hostname, port: u.port, path: "/health", headers: { Host: "evil.example.com" } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    report(status === 403, "http rejects foreign Host header", `status=${status}`);
    const out = (child as any).getStdout() as string;
    report(out === "", "http mode stdout empty", `${out.length} bytes on stdout`);
  } finally {
    child.kill("SIGTERM");
  }
}

await stdioCheck();
await httpCheck();
console.log(failures === 0 ? "\nWIRE: ALL PASS" : `\nWIRE: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
