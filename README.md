# dsh-web-search-anysearch

[![License: MIT](https://img.shields.io/github/license/sheen945/dsh-web-search-anysearch?color=16a34a)](LICENSE)
[![Release](https://img.shields.io/github/v/release/sheen945/dsh-web-search-anysearch?sort=semver&color=4D6BFE)](https://github.com/sheen945/dsh-web-search-anysearch/releases)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.2-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![tests](https://img.shields.io/badge/tests-node%3Atest%207%20passing-16a34a)](test/provider.test.mjs)

**中文** · [English](README.en.md)

把 **DeepSeek Harness** 的 `web_search` 接到 [AnySearch](https://anysearch.com)，替代内置的 DeepSeek 官方搜索（`deepseek-official`），并在 **设置 → 插件** 里给出一张可直接切换的卡片。

- 不改工具、不改提示词：`web_search` 的名字、参数、返回结构全部保持原样，只换后端。
- 家庭配置一次写好：端点、客户端标识都随包带上，密钥按 `配置 → 环境变量 → 密钥文件` 三处任一提供即可。
- 一行切换：设置页卡片上点 `AnySearch` / `DeepSeek 官方` 即时生效，随时可退。

## 它做了什么

`index.js` 是一个 Host 插件，向 `ctx.web` 注册 id 为 `anysearch` 的搜索 provider：

| 环节 | 说明 |
| --- | --- |
| 传输 | `https://api.anysearch.com/mcp`（MCP streamable HTTP，JSON-RPC 2.0）。一次搜索 = 一次 `tools/call` → `search`；该端点无状态，不需要 `initialize` 握手 |
| 解析 | 把 AnySearch 返回的 markdown 结果块（`### N. 标题` / `- **URL**: ...` / 摘要行）映射成 `WebSearchSource { url, title, snippet }`，按 URL 去重 |
| 限流 | AnySearch 约 20 QPS，超限回 `403/429`。插件按 `retryDelayMs × attempt` 指数退避重试（默认共 3 次尝试） |
| 错误码 | 交给 seam 的是 `WEB_PROVIDER_ERROR` / `WEB_PROVIDER_RATE_LIMITED` / `WEB_PROVIDER_TIMEOUT`，与内置 provider 同构 |
| 依赖 | 零第三方依赖，只用全局 `fetch` / `AbortController` / `URL` 与 `node:fs` / `node:os` / `node:path` |

`cordis.patch.yml` 做两件事：

1. `insert` 注册本插件行 `web-search-anysearch`（`inject: [web]`）。
2. 覆盖内置 `web` 行：`searchProvider: anysearch`、`fetchProvider: http`。原 `web-search-deepseek` 行保持注册但不再被选中，删掉覆盖即可回滚。

`client.js` 是浏览器半边：在 设置 → 插件 注册一张 `plugins.item` 卡片（id `anysearch`，order 21，紧挨内置的「网页搜索」）。卡片里两个选项：

- **AnySearch** —— 写入 `web.searchProvider = anysearch`；若该值已是部署默认，则改为清除本地覆盖（不存冗余副本）。
- **DeepSeek 官方** —— 写入 `deepseek-official`，回退到内置搜索。

卡片只依赖 `react` 与 `ctx.configForms` 服务（读写走官方 `ConfigFormController`），不 import 任何 Harness 客户端包，因此对宿主版本不敏感。它与内置「网页搜索」卡片读写同一个 settings 命名空间 `web`，两处状态天然一致：内置卡片里重新选提供方会覆盖本卡片的设置，这是预期行为。

## 安装

需要 DeepSeek Harness `0.2.1-rc.2` 或兼容版本，profile 目录默认 `~/.dsh/profiles/desktop`。

**方式一：让 Agent 装（推荐）**

```
plugin_manager → install_bundle → target: https://github.com/sheen945/dsh-web-search-anysearch
```

或指定本地目录绝对路径，安装的是目录链接（`link:`），之后改代码即时生效、移动目录会失效。

**方式二：手动装**

```bash
git clone https://github.com/sheen945/dsh-web-search-anysearch
cd dsh-web-search-anysearch
# 在 profile 的 package.json 里加依赖，然后
pnpm install
```

并在 profile 的 `cordis.patch.yml`（或 bundle 列表）中把本包列为 bundle，`plugin_manager` 的 `list_bundles` / `set_bundle` 可完成启用。

**方式三：只要远端 provider，不要设置卡片**

把 `cordis.patch.yml` 里 `insert` 那一段抄进自己的 profile patch 即可；`client.js` 不被加载，功能不受影响。

## 配置密钥

本仓库**不含任何凭据**。密钥按顺序解析，命中即用：

1. 插件行的 `apiKey`（`cordis.patch.yml` 里默认留空）
2. 环境变量 `ANYSEARCH_API_KEY`
3. 文件 `~/.dsh/anysearch.key`（Windows：`%USERPROFILE%\.dsh\anysearch.key`）

文件方式最省事：

```powershell
# Windows PowerShell
"as_sk_你的密钥" | Set-Content -NoNewline "$env:USERPROFILE\.dsh\anysearch.key"
```

```bash
# macOS / Linux
printf 'as_sk_你的密钥' > ~/.dsh/anysearch.key && chmod 600 ~/.dsh/anysearch.key
```

密钥可在 [anysearch.com](https://anysearch.com) 控制台获取；AnySearch 也支持匿名低额度访问，但没有密钥时本插件视为未配置（`available() === false`），`web_search` 会报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。

其余可调项：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `endpoint` | `https://api.anysearch.com/mcp` | MCP 端点 |
| `apiKey` | 空 | 优先级最高的密钥来源 |
| `client` | `mcp/1.0.0` | `X-Anysearch-Client` 头 |
| `timeoutMs` | `60000` | 单次搜索超时 |
| `maxAttempts` | `3` | 含首次的总尝试次数 |
| `retryDelayMs` | `1500` | 退避基数（毫秒） |

## 回滚

任选其一：

- 设置页卡片点 **DeepSeek 官方**（临时回退，保留插件）
- `plugin_manager → remove_bundle dsh-web-search-anysearch`
- 把 profile 里 `web` 行的 `searchProvider` 改回 `deepseek-official`

## 验证

1. 让 Agent 跑一次 `web_search`：返回 `Sources:` 列表且来源是 AnySearch 检索结果，即为生效。
2. 设置 → 插件 应能看到「网页搜索 · AnySearch」卡片，当前值显示 `AnySearch`。
3. 报错对照：`WEB_PROVIDER_CONFIGURED_MISSING` / `UNAVAILABLE` → 密钥没落到三处任一处；`WEB_PROVIDER_RATE_LIMITED` → 撞上 20 QPS，调大 `maxAttempts` 或降并发。

## 开发

```bash
node --test        # 7 个用例：解析、去重、密钥优先级、请求形状、错误码
```

测试不触网：`fetch` 被替换为桩函数，`Response` 用 Node 内置实现。

```
index.js            Host 插件（provider + 密钥解析）
client.js           浏览器半边（设置页卡片，仅 react）
cordis.patch.yml    bundle patch：注册插件 + 选中 anysearch
locale/*.json       插件列表里的标题与描述
icon.svg            插件图标
test/*.test.mjs     node:test 用例
```

## 已知限制

- 目录链接安装依赖源目录存在；用打包 tarball 安装则无此约束。
- 密钥文件是明文，权限靠文件系统；多用户机器请用环境变量或让系统密钥环托管后注入 `ANYSEARCH_API_KEY`。
- 搜索结果条数上限 10（AnySearch 侧限制），`web_search` 请求更多时会截断。
- 只替换搜索；网页正文抓取仍由 `fetchProvider: http` 负责（可用 `web-fetch-*` 插件另行替换）。

## 相关项目

生态里同类插件不少，按需挑一个就行，也可以都看看各自的取舍：

- [anysearch-team/anysearch-dsh](https://github.com/anysearch-team/anysearch-dsh) —— AnySearch 官方维护的 DSH 插件，工具更全（垂类搜索、批量、正文提取）
- [RealAlexandreAI/dsh-all-search](https://github.com/RealAlexandreAI/dsh-all-search) —— AnySearch 网页搜索提供方（ctx.web）
- [VinciBeans/dsh-web-search-anysearch](https://github.com/VinciBeans/dsh-web-search-anysearch) —— 可在 Plugins 页切换官方 / AnySearch 的另一实现
- [JPA957/dsh-web-search-anysearch](https://github.com/JPA957/dsh-web-search-anysearch) —— 多 key 轮询与单 key 冷却降级
- 本仓库的取舍：**零第三方依赖 + 仓库不含凭据 + 设置页分段切换**，适合自己一份 key、想随时一键回退的用法

## License

[MIT](LICENSE) © 2026 sheen945

本项目与 AnySearch、DeepSeek 均无隶属关系，只是把公开的 MCP 端点接到 Harness 的搜索 seam 上。使用第三方服务请遵守其服务条款与配额。
