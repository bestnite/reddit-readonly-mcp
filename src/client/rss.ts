// RSS 回退后端（最后手段）：www.reddit.com 的 .rss（Atom）在 json 接口被封时仍可访问。
// 能力有限：最多 ~25 条、没有分数和评论数、不能分页。
// 实测连续请求很快会被 429，因此这里同样遵守 Retry-After 并退避。

import { XMLParser } from "fast-xml-parser";
import { silentLogger, type Logger } from "../logger.js";
import { HttpError, RateLimitError, normalizeFetchError } from "./errors.js";
import { retryAfterMs } from "./reddit-client.js";
import type { ResponseCache } from "./cache.js";
import { LIMITS, truncate } from "./shape.js";
import type { TrimmedPost } from "../types.js";

export const RSS_BASE = "https://www.reddit.com";
export type RssSort = "hot" | "new" | "top" | "rising";

export interface RssClientOptions {
  userAgent: string;
  cache: ResponseCache;
  fetch?: typeof fetch;
  logger?: Logger;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetryWaitMs?: number;
}

export function rssUrl(subreddit: string | undefined, sort: RssSort, timeFilter?: string): string {
  const base = subreddit ? `${RSS_BASE}/r/${encodeURIComponent(subreddit)}` : RSS_BASE;
  const url = new URL(`${base}/${sort}.rss`);
  if (sort === "top" && timeFilter) url.searchParams.set("t", timeFilter);
  return url.toString();
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // entry 只有一条时也保持数组
  isArray: (name) => name === "entry" || name === "link" || name === "category",
  processEntities: true,
  htmlEntities: true,
});

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

// 从 RSS 的 HTML 内容中提取正文（<div class="md"> 部分）并转为纯文本
export function htmlToText(html: string): string {
  const md = /<div class="md">([\s\S]*?)<\/div>/i.exec(html);
  const body = md?.[1] ?? "";
  return decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h\d|pre|blockquote)>/gi, "\n")
      .replace(/<li>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/<!--[\s\S]*?-->/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// RSS 内容里 "[link]" 指向的地址即帖子的外链（文本帖指回帖子本身）
function extractLinkUrl(html: string): string | null {
  const m = /<a href="([^"]+)">\[link\]<\/a>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]) : null;
}

type XmlNode = Record<string, unknown>;

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return String((v as XmlNode)["#text"]);
  return "";
}

export function parseRssFeed(xml: string): TrimmedPost[] {
  const doc = parser.parse(xml) as { feed?: { entry?: XmlNode[] } };
  const entries = doc.feed?.entry ?? [];
  const posts: TrimmedPost[] = [];
  for (const e of entries) {
    const fullname = text(e.id);
    if (!fullname.startsWith("t3_")) continue;
    const id = fullname.slice(3);
    const links = (e.link as XmlNode[] | undefined) ?? [];
    const permalink = String(links[0]?.["@_href"] ?? "");
    const categories = (e.category as XmlNode[] | undefined) ?? [];
    const subreddit = String(categories[0]?.["@_term"] ?? "");
    const authorName = text((e.author as XmlNode | undefined)?.name).replace(/^\/u\//, "");
    const html = text(e.content);
    const linkUrl = extractLinkUrl(html);
    const isSelf = !linkUrl || linkUrl === permalink;
    const published = text(e.published) || text(e.updated);
    const post: TrimmedPost = {
      id,
      fullname,
      title: decodeEntities(text(e.title)),
      author: authorName || "[deleted]",
      subreddit,
      score: null,
      num_comments: null,
      created_utc: published ? new Date(published).toISOString() : "",
      permalink,
      url: linkUrl ?? permalink,
      is_self: isSelf,
    };
    const body = htmlToText(html);
    if (body) {
      const [t, cut] = truncate(body, LIMITS.listingSelftext);
      post.selftext = t;
      if (cut) post.selftext_truncated = true;
    }
    posts.push(post);
  }
  return posts;
}

export class RssClient {
  private readonly o: Required<Omit<RssClientOptions, "cache">> & { cache: ResponseCache };
  private requests = 0;
  private failures = 0;
  private lastError: string | null = null;
  private lastSuccess: number | null = null;

  constructor(o: RssClientOptions) {
    // 显式逐项取默认值：调用方传入的 undefined 不能覆盖默认实现
    this.o = {
      userAgent: o.userAgent,
      cache: o.cache,
      fetch: o.fetch ?? ((...a) => fetch(...a)),
      logger: o.logger ?? silentLogger,
      maxRetries: o.maxRetries ?? 3,
      timeoutMs: o.timeoutMs ?? 20000,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      maxRetryWaitMs: o.maxRetryWaitMs ?? 60_000,
    };
  }

  async listing(subreddit: string | undefined, sort: RssSort, timeFilter: string | undefined, limit: number): Promise<TrimmedPost[]> {
    const url = rssUrl(subreddit, sort, timeFilter);
    const what = subreddit ? `RSS feed r/${subreddit}/${sort}` : `RSS feed /${sort}`;
    const cached = this.o.cache.get<TrimmedPost[]>(url);
    const posts = cached ?? (await this.fetchFeed(url, what));
    return posts.slice(0, limit);
  }

  status() {
    return {
      requests: this.requests,
      failures: this.failures,
      last_error: this.lastError,
      last_success: this.lastSuccess === null ? null : new Date(this.lastSuccess).toISOString(),
    };
  }

  private async fetchFeed(url: string, what: string): Promise<TrimmedPost[]> {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      let res: Response;
      try {
        res = await this.o.fetch(url, {
          headers: { "User-Agent": this.o.userAgent, Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.5" },
          redirect: "follow",
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch (err) {
        this.failures++;
        const e = normalizeFetchError(err, this.o.timeoutMs);
        this.lastError = e.message;
        throw e;
      }
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers, attempt);
        if (attempt >= this.o.maxRetries || wait > this.o.maxRetryWaitMs) {
          this.failures++;
          this.lastError = `HTTP 429 for ${what}`;
          throw new RateLimitError(wait / 1000);
        }
        this.o.logger.warn(`RSS HTTP 429; retry ${attempt + 1}/${this.o.maxRetries} in ${Math.ceil(wait)} ms`);
        await this.o.sleep(wait);
        continue;
      }
      if (!res.ok || !body.includes("<feed")) {
        this.failures++;
        this.lastError = `HTTP ${res.status} for ${what}`;
        throw new HttpError(res.status === 200 ? 502 : res.status, what, true);
      }
      const posts = parseRssFeed(body);
      this.lastSuccess = Date.now();
      this.lastError = null;
      this.o.cache.set(url, posts, body.length, 120_000);
      return posts;
    }
  }
}
