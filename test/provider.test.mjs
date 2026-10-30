import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AnySearchSearchProvider,
  PROVIDER_ID,
  parseSearchText,
  resolveApiKey,
} from '../index.js'

const BODY = `## Search Results (2 results, 812ms)

### 1. AnySearch Docs
- **URL**: https://anysearch.com/docs
- AnySearch 是面向 AI Agent 的搜索基础设施，支持实时网页搜索与结构化正文提取。

### 2. anysearch-mcp-server
- **URL**: https://github.com/anysearch-ai/anysearch-mcp-server
- 统一的实时搜索 MCP 服务端，支持通用搜索、垂类搜索与批量搜索。

### 3. AnySearch Docs
- **URL**: https://anysearch.com/docs
- 重复条目应被去重。
`

test('provider id is the documented one', () => {
  assert.equal(PROVIDER_ID, 'anysearch')
})

test('parseSearchText maps markdown blocks to sources and dedupes by url', () => {
  const sources = parseSearchText(BODY)
  assert.equal(sources.length, 2)
  assert.deepEqual(sources[0], {
    url: 'https://anysearch.com/docs',
    title: 'AnySearch Docs',
    snippet: 'AnySearch 是面向 AI Agent 的搜索基础设施，支持实时网页搜索与结构化正文提取。',
  })
  assert.equal(sources[1].title, 'anysearch-mcp-server')
})

test('parseSearchText returns no sources for a body without blocks', () => {
  assert.deepEqual(parseSearchText('plain text, nothing structured'), [])
})

test('resolveApiKey prefers config, then env, then the key file', () => {
  const fromFile = () => 'as_sk_file'
  assert.equal(resolveApiKey('as_sk_config', { ANYSEARCH_API_KEY: 'as_sk_env' }, fromFile), 'as_sk_config')
  assert.equal(resolveApiKey('  ', { ANYSEARCH_API_KEY: 'as_sk_env' }, fromFile), 'as_sk_env')
  assert.equal(resolveApiKey(undefined, {}, fromFile), 'as_sk_file')
  assert.equal(resolveApiKey(undefined, {}, () => ''), '')
  assert.equal(resolveApiKey({ get: () => 'as_sk_volatile' }, {}, fromFile), 'as_sk_volatile')
})

test('provider is unavailable without a key and available with one', () => {
  const base = { endpoint: 'https://api.anysearch.com/mcp', client: 'mcp/1.0.0', timeoutMs: 1000, maxAttempts: 1, retryDelayMs: 1 }
  assert.equal(new AnySearchSearchProvider({ ...base, apiKey: '' }).available(), false)
  assert.equal(new AnySearchSearchProvider({ ...base, apiKey: 'as_sk_x' }).available(), true)
})

test('search() posts one tools/call and normalizes the answer', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: BODY }], _meta: { request_id: 'req_1' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const provider = new AnySearchSearchProvider({
      endpoint: 'https://api.anysearch.com/mcp',
      apiKey: 'as_sk_x',
      client: 'mcp/1.0.0',
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryDelayMs: 1,
    })
    const result = await provider.search({ query: 'anysearch', maxResults: 99 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.anysearch.com/mcp')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer as_sk_x')
    assert.equal(calls[0].init.headers['X-Anysearch-Client'], 'mcp/1.0.0')
    const sent = JSON.parse(calls[0].init.body)
    assert.equal(sent.method, 'tools/call')
    assert.equal(sent.params.name, 'search')
    assert.equal(sent.params.arguments.query, 'anysearch')
    assert.equal(sent.params.arguments.max_results, 10, 'clamped to the AnySearch cap')
    assert.equal(result.sources.length, 2)
    assert.equal(result.truncated, false)
  } finally {
    globalThis.fetch = original
  }
})

test('search() surfaces HTTP failures with a routable code', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('rate limited', { status: 429 })
  try {
    const provider = new AnySearchSearchProvider({
      endpoint: 'https://api.anysearch.com/mcp',
      apiKey: 'as_sk_x',
      client: 'mcp/1.0.0',
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryDelayMs: 1,
    })
    await assert.rejects(
      () => provider.search({ query: 'x' }),
      (error) => error.code === 'WEB_PROVIDER_RATE_LIMITED',
    )
  } finally {
    globalThis.fetch = original
  }
})
