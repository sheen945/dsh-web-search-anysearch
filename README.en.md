# dsh-web-search-anysearch

[![License: MIT](https://img.shields.io/github/license/sheen945/dsh-web-search-anysearch?color=16a34a)](LICENSE)
[![Release](https://img.shields.io/github/v/release/sheen945/dsh-web-search-anysearch?sort=semver&color=4D6BFE)](https://github.com/sheen945/dsh-web-search-anysearch/releases)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.2-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![tests](https://img.shields.io/badge/tests-node%3Atest%207%20passing-16a34a)](test/provider.test.mjs)

[中文](README.md) · **English**

Point DeepSeek Harness's `web_search` at [AnySearch](https://anysearch.com) instead of the built-in DeepSeek search (`deepseek-official`), and get a one-click switch card in **Settings → Plugins**.

- Same tool, different backend: `web_search` keeps its name, parameters, and result shape.
- Nothing to fill in but the key: endpoint and client id ship with the package.
- Reversible at any time: the card toggles between `AnySearch` and `DeepSeek official`; removing the bundle restores the default.

## What it does

`index.js` is a Host plugin that registers a search provider with id `anysearch` on `ctx.web`:

| Piece | Detail |
| --- | --- |
| Transport | `https://api.anysearch.com/mcp` — MCP streamable HTTP, JSON-RPC 2.0. One search = one `tools/call` on `search`; the endpoint is stateless, so no `initialize` handshake |
| Parsing | AnySearch's markdown result blocks (`### N. Title` / `- **URL**: ...` / excerpt) become `WebSearchSource { url, title, snippet }`, deduped by URL |
| Rate limits | AnySearch allows ~20 QPS and answers `403/429` beyond it; the provider backs off `retryDelayMs × attempt` (3 attempts by default) |
| Error codes | `WEB_PROVIDER_ERROR`, `WEB_PROVIDER_RATE_LIMITED`, `WEB_PROVIDER_TIMEOUT` — the same codes the built-in provider raises |
| Dependencies | None beyond `fetch`, `AbortController`, `URL`, and the `node:fs` / `node:os` / `node:path` builtins |

`cordis.patch.yml` inserts the plugin row and overrides the built-in `web` row with `searchProvider: anysearch` and `fetchProvider: http`. The stock `web-search-deepseek` row stays registered but unselected, so rollback is a one-line revert.

`client.js` is the browser half: a `plugins.item` card (`id: anysearch`, order 21) next to the built-in Web Search card. It writes the same `web.searchProvider` field through the official `ctx.configForms` controller and imports nothing but `react`, so it does not break when harness client packages change.

## Install

Requires DeepSeek Harness `0.2.1-rc.2` or a compatible build; the profile defaults to `~/.dsh/profiles/desktop`.

**Via the agent (recommended)**

```
plugin_manager → install_bundle → target: https://github.com/sheen945/dsh-web-search-anysearch
```

Point `target` at a local directory instead to link the checkout (edits apply live; moving the directory breaks the install).

**Manually**

```bash
git clone https://github.com/sheen945/dsh-web-search-anysearch
# add it as a profile dependency, install, and list it in the profile bundle set
```

## Key

The repository holds no credential. The key is resolved in this order, first hit wins:

1. the plugin row's `apiKey` (empty in `cordis.patch.yml`)
2. `ANYSEARCH_API_KEY`
3. `~/.dsh/anysearch.key` (`%USERPROFILE%\.dsh\anysearch.key` on Windows)

```bash
printf 'as_sk_your_key' > ~/.dsh/anysearch.key && chmod 600 ~/.dsh/anysearch.key
```

Without a key the provider reports itself unavailable and `web_search` answers `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.

| Option | Default | Meaning |
| --- | --- | --- |
| `endpoint` | `https://api.anysearch.com/mcp` | MCP endpoint |
| `apiKey` | empty | Highest-priority key source |
| `client` | `mcp/1.0.0` | `X-Anysearch-Client` header |
| `timeoutMs` | `60000` | Per-search timeout |
| `maxAttempts` | `3` | Total attempts including the first |
| `retryDelayMs` | `1500` | Backoff base in milliseconds |

## Rollback

Any of: pick **DeepSeek official** in the card; `plugin_manager → remove_bundle dsh-web-search-anysearch`; set the profile's `web.searchProvider` back to `deepseek-official`.

## Verify

Run a `web_search` and check the sources come from AnySearch, then confirm the card shows **AnySearch** as current. `WEB_PROVIDER_RATE_LIMITED` means the 20 QPS cap was hit.

## Develop

```bash
node --test    # 7 cases: parsing, dedupe, key precedence, request shape, error codes
```

Tests never touch the network; `fetch` is stubbed.

## Related

The ecosystem has several AnySearch plugins; pick one, or compare the trade-offs:

- [anysearch-team/anysearch-dsh](https://github.com/anysearch-team/anysearch-dsh) — maintained by AnySearch, with the full tool set (vertical search, batch, extraction)
- [RealAlexandreAI/dsh-all-search](https://github.com/RealAlexandreAI/dsh-all-search) — AnySearch web search provider on `ctx.web`
- [VinciBeans/dsh-web-search-anysearch](https://github.com/VinciBeans/dsh-web-search-anysearch) — another implementation with an official/AnySearch switch
- [JPA957/dsh-web-search-anysearch](https://github.com/JPA957/dsh-web-search-anysearch) — multi-key rotation with per-key cooldown
- This repository's trade-off: **no third-party dependencies, no credential in the repo, a segmented switch in Settings** — for one key of your own and instant rollback

## License

[MIT](LICENSE) © 2026 sheen945

Not affiliated with AnySearch or DeepSeek. The plugin only wires a public MCP endpoint into the Harness search seam; respect the provider's terms and quota.
