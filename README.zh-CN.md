[English](README.md) | **简体中文**

# reddit-readonly-mcp

一个轻量、高效的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务器。**无需任何 Reddit API 密钥或账号凭据，即可直接从机房 / VPS IP 稳定读取 Reddit 公开数据**（帖子、评论、版块与用户信息）。

项目借鉴了 [redlib](https://github.com/redlib-org/redlib) 的技术方案，通过模拟 Reddit 官方 Android 客户端的 Token 交换流程，获取匿名的 application-only token 直接与 `oauth.reddit.com` 通信，有效解决云服务器 IP 访问 Reddit 时普遍遭遇的 403 与反爬拦截。

---

## ✨ 核心特性

- 🔑 **零凭据依赖**：无需申请 Reddit 开发者应用审批，无需填写 API Secret，无需提供账号密码。
- 🌐 **机房 / VPS 友好**：原生绕过 Reddit 对数据中心 IP 的阻断与访问限制。
- 🛡️ **严格只读与隐私安全**：仅读取公开内容；代码中完全移除写操作与账号级凭据逻辑，杜绝凭据泄露风险。
- 🔄 **三级高可用降级（Cascade）**：`Mobile Token` → `Installed Client Token` → `RSS Fallback` 自动级联切换。
- ⚡ **智能配额管理与缓存**：实时监控速率限制，在剩余请求数 $\le 5$ 时主动轮换 Token，支持 429 智能重试与内存 LRU 缓存。
- 🔌 **双传输协议支持**：支持面向本地 Agent 的标准 `stdio` 协议，以及面向容器与远程网关的 Streamable `HTTP` 协议。

---

## 🚀 快速上手

### 环境要求

- [Node.js](https://nodejs.org/) $\ge 20$

### 1. 直接运行

已发布到 npm：**`reddit-readonly-mcp`**（v0.1.0）：

```bash
npx -y reddit-readonly-mcp          # stdio，MCP 客户端启动的方式
```

或全局安装：

```bash
npm i -g reddit-readonly-mcp
reddit-readonly-mcp
```

或直接跑 Gitea 仓库上的最新 `main`：

```bash
npx --allow-git=all -y "git+https://git.nite07.com/nite/reddit-readonly-mcp.git"
```

### 2. 配置 MCP 客户端

#### 标准 stdio 配置（Claude Desktop / Cursor 等）

在 MCP 配置文件（如 `claude_desktop_config.json` 或 Cursor 的 `mcp.json`）中添加：

```json
{
  "mcpServers": {
    "reddit": {
      "command": "npx",
      "args": ["-y", "reddit-readonly-mcp"]
    }
  }
}
```

#### Hermes Agent（`~/.hermes/config.yaml`）

```yaml
mcp_servers:
  reddit:
    command: npx
    args:
      - "-y"
      - reddit-readonly-mcp
```

#### Streamable HTTP 模式

适用于 Docker 容器部署、MetaMCP 或集中式 MCP 网关集成：

```bash
npx -y reddit-readonly-mcp --http --port 3000 --host 127.0.0.1
```

- MCP 服务端点：`http://127.0.0.1:3000/mcp`
- 健康检查端点：`GET http://127.0.0.1:3000/health`
- *说明：* HTTP 传输默认绑定到 `127.0.0.1`，并强制校验 Host 头以防范 DNS 重绑定攻击；服务端未设身份鉴权，若需暴露至外网请前置反向代理鉴权。

### 3. 从源码运行（开发）

```bash
git clone https://git.nite07.com/nite/reddit-readonly-mcp.git
cd reddit-readonly-mcp
npm install && npm run build
node dist/cli.js
```

编译产物位于 `dist/cli.js`。

---

## 🛠️ 可用工具清单

服务器内置 **12 个严格只读工具**（带有 `readOnlyHint: true` 标记）。返回字段均经过标准化裁剪与脱敏（提取 id、标题、作者、版块、得分、发布时间、链接、截断正文等），绝不直接倾倒原始无意义的冗长 JSON。

### 帖子与信息流

| 工具名                    | 功能说明                                                                                  | 核心参数                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `browse_subreddit`        | 浏览版块列表，支持 `hot`、`new`、`top`、`rising`、`controversial` 排序。*(支持 RSS 降级)* | `subreddit?`, `sort`, `time_filter`, `limit`, `after`                                 |
| `get_top_posts`           | 获取指定版块或默认首页在特定时间范围内的热门帖子。*(支持 RSS 降级)*                       | `subreddit?`, `time_filter` (`day`, `week`, `month`, `year`, `all`), `limit`, `after` |
| `get_reddit_post`         | 获取单个帖子的完整详情。                                                                  | `id`（base36 ID、`t3_` fullname 或帖子链接）                                          |
| `get_trending_subreddits` | 获取当前全站热门/趋势版块（`/subreddits/popular`）。                                      | `limit`, `after`                                                                      |

### 评论与讨论树

| 工具名              | 功能说明                   | 核心参数                                                            |
| ------------------- | -------------------------- | ------------------------------------------------------------------- |
| `get_post_comments` | 获取帖子的结构化树状评论。 | `post_id`, `sort` (`confidence`, `top`, `new` 等), `limit`, `depth` |

> **关于评论折叠桩的说明：** Reddit 官方接口对匿名 Token 的 `/api/morechildren` 请求直接返回 403，因此本服务无法展开深层被折叠的 `more` 评论桩。如需检索更深层讨论，请在调用时直接调大 `limit` 或 `depth`。

### 内容搜索

| 工具名          | 功能说明                                                                                          | 核心参数                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `search_reddit` | 搜索全站或指定版块中的帖子、版块或用户，支持高级搜索语法（`author:`、`flair:`、双引号精确匹配）。 | `query`（或 `q`）, `subreddit?`, `sort`, `time_filter`, `type` (`link`, `sr`, `user`), `limit`, `after` |

### 社区与用户档案

| 工具名                | 功能说明                                       | 核心参数                                            |
| --------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `get_subreddit_info`  | 查询版块元数据、简介描述、订阅人数及规则概览。 | `subreddit`                                         |
| `get_subreddit_rules` | 查询指定版块的发帖与社区规范。                 | `subreddit`                                         |
| `get_user_info`       | 查询用户的公开主页资料、Karma 得分及注册时间。 | `username`                                          |
| `get_user_posts`      | 查询指定用户公开发布的帖子列表。               | `username`, `sort`, `time_filter`, `limit`, `after` |
| `get_user_comments`   | 查询指定用户公开发布的评论历史。               | `username`, `sort`, `time_filter`, `limit`, `after` |

### 服务诊断

| 工具名   | 功能说明                                                                                                     | 核心参数 |
| -------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| `doctor` | 诊断服务器运行状态：当前生效后端、是否降级、Token 到期时间、速率剩余限额及缓存命中统计。排查问题时首选调用。 | 无       |

---

## ⚙️ 架构设计与容灾降级

为了在无需凭据的前提下实现稳定读取，`reddit-readonly-mcp` 实现了三层容灾流水线：

```
[请求发起]
   │
   ▼
1. Mobile OAuth Token ──── (连续失败 5 次) ───► 2. Installed Client Grant
   │ (默认主通道：auth/v2/oauth/access-token/loid)     │
   │                                                   ▼ (连续失败 5 次)
   └────────────────────────────────────────────► 3. Public RSS Fallback
                                                       (仅 browse_subreddit 与 get_top_posts)
```

1. **移动端 Token（`mobile`）**：默认首选通道。模拟 Android 客户端握手，生成真实的虚拟设备指纹，换取 24 小时有效的应用级 Token。
2. **安装客户端 Token（`installed`）**：当 `mobile` 接口连续失败 5 次后自动切换至次级鉴权通道。
3. **公开 RSS 兜底（`rss`）**：当所有 Token 接口均被限制时的保底通道，保障核心帖子流的持续可读。
4. **自动探测恢复**：服务在降级后每隔 30 分钟会自动探测并恢复更高优先级的高速通道。

### 配额管理与性能优化

- **提前刷新**：Token 到期前 2 分钟在后台异步静默刷新。
- **主动轮换**：监控响应头中的 `x-ratelimit-remaining`；当剩余次数 $\le 5$ 时主动刷新 Token 以获得全新的配额窗口。
- **429 智能重试**：遇到 429 限制时先换新 Token，并按响应头的 `Retry-After` 指数退避重试。
- **内存 LRU 缓存**：内置基于字节大小上限的 LRU 缓存，避免短期内高频重复请求同一内容。

---

## 🔧 环境变量配置

所有配置项均为可选，无需配置任何账号密码或密钥凭据。

| 环境变量                  | 默认值           | 说明                                                                        |
| ------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `REDDIT_AUTH_MODE`        | `auto`           | 鉴权模式：`auto`（启用级联降级）、`mobile`、`installed`、`rss`。            |
| `REDDIT_MOBILE_CLIENT_ID` | `ohXpoqrZYub1kg` | Android 客户端 ID，官方常量失效时可配置自定义 ID 覆盖。                     |
| `REDDIT_CACHE`            | `on`             | 是否启用内存只读缓存（`on` / `off`）。                                      |
| `REDDIT_CACHE_MAX_MB`     | `50`             | 内存 LRU 缓存上限（MB）。                                                   |
| `REDDIT_MAX_RETRIES`      | `3`              | 遭遇 429 时的最大重试次数。                                                 |
| `REDDIT_TIMEOUT_MS`       | `20000`          | 单次 HTTP 请求超时时间（毫秒）。                                            |
| `REDDIT_LOG_LEVEL`        | `info`           | 日志输出级别（输出至 stderr）：`debug`、`info`、`warn`、`error`、`silent`。 |

---

## 📋 边界与设计说明

- **严格只读设计**：不提供发帖、评论、点赞投票或私信功能。这些操作需要用户级 OAuth 授权及绑定账号，不属于本工具范畴。
- **仅公开数据**：无法读取私密版块、被封禁用户或需登录的私有接口（如个人收藏、收件箱等）。
- **深层折叠评论不可展开**：由于 Reddit 官方限制，匿名 Token 请求 `/api/morechildren` 必定返回 403；如需更多评论，请直接增大 `get_post_comments` 的 `limit` 与 `depth`。

---

## 🧪 开发与测试

```bash
# 编译 TypeScript 至 dist/
npm run build

# 类型检查
npm run typecheck

# 单元测试（使用 mock 数据，无需外网连接）
npm test

# 协议测试（验证 stdio 与 HTTP 双协议交互）
npm run wire

# 全功能真网冒烟测试（直接访问真实 Reddit 端点）
npm run smoke
```

---

## 📄 开源许可证

本项目基于 [MIT](LICENSE) 协议开源。`src/auth/android-app-versions.ts` 中的设备指纹数据来源于 [redlib](https://github.com/redlib-org/redlib)（MIT）。
