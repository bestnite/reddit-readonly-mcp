// 写操作安全模式（行为参照 reddit-mcp-server）：
//   standard：写操作之间至少间隔 2 s；拒绝与最近内容相同的写入；拒绝把同一内容发到不同 subreddit
//   strict：  间隔 5 s，记住更多历史，每小时写入上限更低
//   off：     不做任何防护
// 所有写操作串行执行，避免并发写绕过重复检测。

import { createHash } from "node:crypto";
import type { SafeModeLevel } from "../config.js";
import { SafeModeError } from "../client/errors.js";
import { E } from "../messages.js";
import { silentLogger, type Logger } from "../logger.js";

export interface SafeModePolicy {
  mode: SafeModeLevel;
  minDelayMs: number;
  duplicateCheck: boolean;
  // 记住最近多少条内容指纹
  historySize: number;
  // 每小时最多写入次数，0 表示不限
  maxWritesPerHour: number;
}

export const SAFE_MODE_POLICIES: Record<SafeModeLevel, SafeModePolicy> = {
  off: { mode: "off", minDelayMs: 0, duplicateCheck: false, historySize: 0, maxWritesPerHour: 0 },
  standard: { mode: "standard", minDelayMs: 2_000, duplicateCheck: true, historySize: 10, maxWritesPerHour: 30 },
  strict: { mode: "strict", minDelayMs: 5_000, duplicateCheck: true, historySize: 20, maxWritesPerHour: 10 },
};

export interface WriteIntent {
  // 用于日志与状态
  action: string;
  // 需要做重复检测的内容（正文 / 链接 / 回复文本）；删除操作不传
  content?: string;
  // 目标 subreddit（未知时不传）
  subreddit?: string;
}

interface Record_ {
  hash: string;
  subreddit: string | null;
  at: number;
}

export function contentFingerprint(content: string): string {
  // 大小写与空白差异不算不同内容
  const norm = content.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(norm).digest("hex");
}

export class SafeMode {
  readonly policy: SafeModePolicy;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Logger;
  private history: Record_[] = [];
  private writeTimes: number[] = [];
  private lastWriteAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private rejected = 0;

  constructor(
    level: SafeModeLevel,
    deps: { now?: () => number; sleep?: (ms: number) => Promise<void>; logger?: Logger } = {},
  ) {
    this.policy = SAFE_MODE_POLICIES[level];
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.logger = deps.logger ?? silentLogger;
  }

  // 在安全模式约束下执行一次写操作：检查 → 等待最小间隔 → 执行 → 成功后记录
  run<T>(intent: WriteIntent, fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(() => this.execute(intent, fn));
    // 队列不因单个失败而中断
    this.queue = task.catch(() => undefined);
    return task;
  }

  // 只做检查不执行（测试与预检用）
  check(intent: WriteIntent): void {
    const p = this.policy;
    if (p.mode === "off") return;
    const now = this.now();
    if (p.maxWritesPerHour > 0) {
      this.writeTimes = this.writeTimes.filter((t) => now - t < 3_600_000);
      if (this.writeTimes.length >= p.maxWritesPerHour) {
        this.rejected++;
        throw new SafeModeError(E.safeHourlyCap(p.maxWritesPerHour, p.mode));
      }
    }
    if (p.duplicateCheck && intent.content !== undefined && intent.content.trim() !== "") {
      const hash = contentFingerprint(intent.content);
      const sub = intent.subreddit?.toLowerCase() ?? null;
      const dup = this.history.find((r) => r.hash === hash);
      if (dup) {
        this.rejected++;
        if (sub !== null && dup.subreddit !== null && dup.subreddit !== sub) {
          throw new SafeModeError(E.safeCrossSubreddit(dup.subreddit, sub));
        }
        throw new SafeModeError(E.safeDuplicate);
      }
    }
  }

  status() {
    const now = this.now();
    return {
      mode: this.policy.mode,
      min_delay_ms: this.policy.minDelayMs,
      duplicate_check: this.policy.duplicateCheck,
      history_size: this.policy.historySize,
      max_writes_per_hour: this.policy.maxWritesPerHour,
      writes_last_hour: this.writeTimes.filter((t) => now - t < 3_600_000).length,
      rejected: this.rejected,
    };
  }

  private async execute<T>(intent: WriteIntent, fn: () => Promise<T>): Promise<T> {
    this.check(intent);
    const p = this.policy;
    if (p.minDelayMs > 0 && this.lastWriteAt > 0) {
      const wait = this.lastWriteAt + p.minDelayMs - this.now();
      if (wait > 0) {
        this.logger.info(`Safe mode: waiting ${wait} ms before ${intent.action}`);
        await this.sleep(wait);
      }
    }
    try {
      const result = await fn();
      // 在释放队列之前记录，保证排在后面的写入能看到这条指纹
      this.record(intent);
      return result;
    } finally {
      // 无论成功失败都计入写入节奏，避免失败重试时连续轰炸
      this.lastWriteAt = this.now();
    }
  }

  // 只记录成功的写入（失败的写入不记录指纹，便于修改后重试）
  private record(intent: WriteIntent): void {
    if (this.policy.mode === "off") return;
    this.writeTimes.push(this.now());
    if (this.policy.duplicateCheck && intent.content !== undefined && intent.content.trim() !== "") {
      this.history.push({
        hash: contentFingerprint(intent.content),
        subreddit: intent.subreddit?.toLowerCase() ?? null,
        at: this.now(),
      });
      if (this.history.length > this.policy.historySize) {
        this.history = this.history.slice(-this.policy.historySize);
      }
    }
  }
}
