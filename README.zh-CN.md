[English](README.md) | **简体中文**

# reddit-mcp

一个非官方的 Reddit [Model Context Protocol](https://modelcontextprotocol.io) 服务器，**无需任何 Reddit API 凭据，
即可从机房 / VPS IP 读取 Reddit 公开数据**。它按照 Reddit 官方 Android 客户端的方式获取匿名的 application-only
token（即 [redlib](https://github.com/redlib-org/redlib)（MIT）所用的技术），然后访问 `oauth.reddit.com`。

**本服务器是只读的。** 它提供十二个工具，用于读取公开的帖子、评论、用户和版块信息；没有任何发帖、回复、编辑、删除、
投票、私信或读取账号数据的工具，也从不索要 Reddit 凭据。读工具的名称与语义沿用
[jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server)，为其中一个编写的只读提示词可以直接用于另一个。

## ⚠️ 风险提示（请先阅读）

- **本服务器在设计上就是只读的。** 写操作工具是被刻意移除的：发帖、回复和投票都需要用户上下文的 token，
  这意味着要么有一个注册过的 Reddit app（自助创建已于 2025 年 11 月关闭，现在需要审批），要么把你的 Reddit 账号凭据交给本工具。
  这两者都不在本项目范围内，因此没有任何代码路径会接受 Reddit 用户名、密码或 app secret。
- **client id `ohXpoqrZYub1kg` 是 Reddit Android 客户端公开的常量。** 冒充官方 Android 客户端与 Reddit 的
  Responsible Builder Policy 相冲突，Reddit 随时可能吊销或更换该 id。失效时可以通过 `REDDIT_MOBILE_CLIENT_ID`
  覆盖；在此期间级联会降级到 RSS，两个支持 RSS 的工具仍可使用。
- **伪装身份只用于读取公开数据。** 它只换取匿名的 application-only token；服务器不会以任何 Reddit 账号的身份执行操作。
- **不保证可用性和正确性。** 这是一个调用未公开接口的非官方客户端，任何接口都可能在没有通知的情况下变更或消失。

## 快速开始

需要 Node.js ≥ 20。

```bash
npm install
npm run build

# stdio（默认）——MCP 客户端启动的方式
npx reddit-mcp            # 或：node dist/cli.js

# Streamable HTTP：http://127.0.0.1:3000/mcp（另有 GET /health）
npx reddit-mcp --http --port 3000 --host 127.0.0.1
```

npm 包名为 `reddit-mobile-mcp`（`reddit-mcp` 在 npm 上已被占用），安装后的可执行文件名为 `reddit-mcp`，
因此发布后命令是 `npx reddit-mobile-mcp`。

MCP 客户端配置示例（stdio），请使用你本地检出目录的绝对路径：

```json
{
  "mcpServers": {
    "reddit": { "command": "node", "args": ["/path/to/reddit-mcp/dist/cli.js"] }
  }
}
```

stdio 模式下 stdout 只输出 MCP 协议消息，所有日志都写到 stderr。HTTP 传输默认只监听回环地址，并拒绝 `Host`
头不是回环名称的请求（防 DNS rebinding）。空闲 30 分钟的 HTTP 会话会被关闭。HTTP 端点**没有鉴权**——除非前面有其他保护，否则不要绑定到公网接口。

## 读取原理

| 步骤 | 后端 | 说明 |
|---|---|---|
| 1 | `mobile` | `POST https://www.reddit.com/auth/v2/oauth/access-token/loid`，HTTP Basic `<android client id>:`（空密码），JSON 请求体 `{"scopes":["*","email","pii"]}`，附带 Android 请求头。返回 24 小时有效的 token 以及 `x-reddit-loid` / `x-reddit-session`，之后每个请求都会带上这两个头。 |
| 2 | `installed` | `mobile` **连续失败 5 次**后：`POST https://www.reddit.com/api/v1/access_token`，使用 `installed_client` grant 和相同的 Basic 认证。 |
| 3 | `rss` | 再连续失败 5 次后：使用公开 RSS。只有 `browse_subreddit` 和 `get_top_posts` 继续可用（最多约 25 条，没有分数 / 评论数 / 分页）；其他工具会返回说明原因的错误。 |
| 4 | — | 如果 RSS 也失败，工具返回可操作的错误信息——绝不静默返回错误结果。 |

细节：

- 每个进程生成一次 Android 设备身份（从 redlib 的真实版本列表中随机选取 app 版本、Android 9–14、用于
  `client-vendor-id` / `X-Reddit-Device-Id` 的 uuid），之后所有请求复用。
- token 缓存在内存中，**到期前 2 分钟**刷新；同一时刻只有一个刷新在进行。
- 只有 HTTP 层面的拒绝（4xx/5xx、token 响应缺字段）才计为后端失败。纯网络错误和超时只会让本次调用返回网络错误，
  **不会**推动级联降级到 RSS（RSS 与 token 接口在同一主机上，降级无济于事）。token 请求最长 10 秒超时。
- 每个响应都会记录 `x-ratelimit-remaining`；降到 **≤ 5** 时轮换 token（新 token 拥有新的约 100 次请求窗口）。
  匿名读请求遇到 `429` 时先触发同样的轮换，之后再按 `Retry-After` 最多重试 `REDDIT_MAX_RETRIES` 次。
  遇到 `401` 刷新 token 并重试一次。
- 降级之后，每 30 分钟按顺序（先 mobile，再 installed）重新尝试更优的后端，成功后自动切回。
- token、`x-reddit-loid` 和 `x-reddit-session` 永远不会被记录到日志或返回（日志和工具输出还会经过一层脱敏过滤）。
- `REDDIT_AUTH_MODE=mobile|installed|rss` 固定使用某一后端，并关闭级联降级。

## 配置

所有环境变量均为可选。没有任何凭据类变量：不会读取 Reddit app 的 id / secret，也不会读取账号用户名 / 密码。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `REDDIT_AUTH_MODE` | `auto` | `auto` / `mobile` / `installed` / `rss` |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android client id（被吊销时的覆盖入口） |
| `REDDIT_CACHE` | `on` | 内存读缓存 `on` / `off` |
| `REDDIT_CACHE_MAX_MB` | `50` | LRU 上限 |
| `REDDIT_MAX_RETRIES` | `3` | 429 时按 `Retry-After` 重试的次数 |
| `REDDIT_TIMEOUT_MS` | `20000` | 单个请求超时 |
| `REDDIT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`（输出到 stderr） |

## 工具

恰好十二个工具，全部只读、匿名（标注为 `readOnlyHint: true`）。列表类工具接受 `limit`，在 Reddit 支持时还接受
`after`，返回 `{"data": [...], "after": cursor|null}`，字段经过裁剪（id、fullname、title、author、subreddit、score、
num_comments、ISO 格式的 `created_utc`、permalink、url、截断后的 selftext/body）——绝不返回 Reddit 原始 JSON。

| 工具 | 说明 |
|---|---|
| `get_reddit_post` | 按 id / fullname / 永久链接获取单个帖子 |
| `get_top_posts` | `subreddit?`、`time_filter`（默认 week）。**RSS 模式下可用。** |
| `browse_subreddit` | `sort`：hot/new/top/rising/controversial，top/controversial 使用 `time_filter`。**RSS 模式下可用**（controversial 除外）。 |
| `search_reddit` | `query`（别名 `q`）、可选 `subreddit`、`sort`、`time_filter`、`type`（link/sr/user） |
| `get_post_comments` | `limit`、`depth`、`sort`；嵌套回复 + `more` 桩。本服务器**无法展开** `more` 桩：Reddit 对匿名 token 的 `/api/morechildren` 请求返回 HTTP 403。需要更多评论时请调大 `limit` / `depth`。 |
| `get_user_info` | 公开资料 |
| `get_user_posts` / `get_user_comments` | `sort`、`time_filter`、分页 |
| `get_subreddit_info` | 版块元数据与侧边栏 |
| `get_subreddit_rules` | 发帖规则 |
| `get_trending_subreddits` | Reddit 的 `/subreddits/popular` |
| `doctor` | 诊断，无参数：当前后端、级联是否已降级（及原因）、token 到期时间、当前 `x-ratelimit-remaining` / 重置窗口 / 轮换次数、缓存与请求统计。其他工具出错时先调用它。 |

刻意不提供：

- **写操作**（发帖、回复、编辑、删除）和**账号工具**（自己的资料、收藏、动态）——它们需要用户身份，见*风险提示*。
- **投票和私信**（Responsible Builder Policy）。
- **展开 `more` 桩**（匿名 token 访问 `/api/morechildren` → 403）和 **link flair 模板**（匿名 token 访问
  `/r/<sub>/api/link_flair_v2` → `USER_REQUIRED`）。不会改走其他接口来绕过。

## 开发

```bash
npm run build      # tsup -> dist/cli.js
npm run typecheck  # tsc --noEmit（strict）
npm test           # vitest 单元测试，不访问网络
npm run smoke      # 针对真实 Reddit 对全部 12 个工具做实网测试（需要网络）
npm run wire       # 启动 dist/cli.js，检查 stdio 与 HTTP 的协议交互（doctor 会访问网络）
```

代码结构与约定见 [AGENTS.md](AGENTS.md)（英文）。

## 许可证

MIT。`src/auth/android-app-versions.ts` 中的 Android app 版本列表复制自 redlib（MIT）。
