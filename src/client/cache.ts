// 进程内只读响应缓存：按字节数做 LRU 淘汰，每个条目有自己的 TTL。
// 只缓存匿名读请求的解析结果。

interface Entry {
  value: unknown;
  bytes: number;
  expiresAt: number;
}

export class ResponseCache {
  private readonly map = new Map<string, Entry>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    readonly enabled: boolean,
    readonly maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined;
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (this.now() >= e.expiresAt) {
      this.delete(key);
      this.misses++;
      return undefined;
    }
    // 重新插入以更新 LRU 顺序
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value as T;
  }

  // bytes 由调用方传入（原始响应文本长度），避免重复序列化
  set(key: string, value: unknown, bytes: number, ttlMs: number): void {
    if (!this.enabled || ttlMs <= 0 || bytes > this.maxBytes) return;
    this.delete(key);
    this.map.set(key, { value, bytes, expiresAt: this.now() + ttlMs });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
      this.evictions++;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  private delete(key: string): void {
    const e = this.map.get(key);
    if (e) {
      this.bytes -= e.bytes;
      this.map.delete(key);
    }
  }

  stats() {
    return {
      enabled: this.enabled,
      entries: this.map.size,
      bytes: this.bytes,
      max_bytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}
