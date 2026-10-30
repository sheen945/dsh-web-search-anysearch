/**
 * AnySearch search provider for the Harness web seam (`ctx.web`).
 *
 * Registers a `WebSearchProvider` with id `anysearch` so that `web_search`
 * resolves to AnySearch instead of the built-in DeepSeek search route.
 *
 * Transport: the AnySearch remote MCP endpoint (`https://api.anysearch.com/mcp`,
 * streamable HTTP, JSON-RPC 2.0). One search = one `tools/call` on `search`;
 * the endpoint is stateless, so no `initialize` handshake is required.
 *
 * No runtime dependencies: only global `fetch`/`AbortController`/`URL` plus the
 * `node:fs`/`node:os`/`node:path` builtins, so the module resolves from any
 * profile layout.
 *
 * The credential is resolved at activation from the row config, then
 * `ANYSEARCH_API_KEY`, then `~/.dsh/anysearch.key`, so this package ships no
 * secret.
 *
 * @module dsh-web-search-anysearch
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable id this provider registers under. */
const PROVIDER_ID = 'anysearch'

/**
 * Machine-local key file, read only when neither the row config nor the
 * environment supplies a key. Keeping the key here means the published patch
 * can stay credential-free.
 */
const KEY_FILE = join(homedir(), '.dsh', 'anysearch.key')

/** Package name, as reported by the Loader row. */
export const name = 'web-search-anysearch'

/** The web seam must exist before this plugin registers into it. */
export const inject = ['web']

/** Default AnySearch remote MCP endpoint. */
const DEFAULT_ENDPOINT = 'https://api.anysearch.com/mcp'

/** Default attribution header value sent on every request. */
const DEFAULT_CLIENT = 'mcp/1.0.0'

/** Default per-request timeout (one search). */
const DEFAULT_TIMEOUT_MS = 60_000

/** Default attempt count; AnySearch answers 403/429 when the 20 QPS cap is hit. */
const DEFAULT_MAX_ATTEMPTS = 3

/** Default delay between attempts, in milliseconds. */
const DEFAULT_RETRY_DELAY_MS = 1_500

/** Upper bound on one source snippet kept in the result (context stays small). */
const SNIPPET_MAX_CHARS = 320

/** Upper bound on the fallback `content` block when nothing is parseable. */
const CONTENT_MAX_CHARS = 2_000

/** AnySearch caps `max_results` at 10. */
const ANYSEARCH_MAX_RESULTS = 10

/** The Harness tool caps a search at 8 sources by default; keep a sane floor. */
const DEFAULT_MAX_RESULTS = 8

/**
 * Read a config value that may be a plain value or a `schemastery` volatile
 * observable (`.get()`), so both a raw patch row and a settings-bound row work.
 *
 * @param value - the configured value.
 * @param fallback - used when the value is absent.
 * @returns the resolved value.
 */
function readValue(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'object' && typeof value.get === 'function') {
    const current = value.get()
    return current === undefined || current === null ? fallback : current
  }
  return value
}

/** Collapse whitespace so a snippet stays on one line. */
function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** Read the machine-local key file; a missing file is not an error. */
function readKeyFile() {
  try {
    return readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Resolve the AnySearch credential from the first source that provides one:
 * the plugin row config, then `ANYSEARCH_API_KEY`, then `~/.dsh/anysearch.key`.
 *
 * @param configured - the row's `apiKey` value (plain or volatile).
 * @param env - environment to read the fallback key from.
 * @param readFile - key-file reader, injectable for tests.
 * @returns the key, or an empty string when no source supplies one.
 */
export function resolveApiKey(configured, env = process.env, readFile = readKeyFile) {
  const fromConfig = readValue(configured, '')
  if (typeof fromConfig === 'string' && fromConfig.trim().length > 0) return fromConfig.trim()
  const fromEnv = env.ANYSEARCH_API_KEY
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return readFile()
}

/**
 * Parse the AnySearch markdown result body into normalized sources.
 *
 * Shape:
 * ```
 * ## Search Results (3 results, 1245ms)
 *
 * ### 1. Title
 * - **URL**: https://example.com/page
 * - excerpt text...
 * ```
 *
 * @param text - the `content[0].text` payload.
 * @returns the parsed sources, in provider order, deduped by URL.
 */
function parseSearchText(text) {
  const sources = []
  const seen = new Set()
  let current

  const flush = () => {
    if (current !== undefined && current.url !== undefined && !seen.has(current.url)) {
      seen.add(current.url)
      sources.push({
        url: current.url,
        ...(current.title.length > 0 ? { title: current.title } : {}),
        ...(current.snippet.length > 0 ? { snippet: current.snippet } : {}),
      })
    }
    current = undefined
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const heading = /^#{2,4}\s+\d+[.)]\s*(.+?)\s*$/.exec(line.trim())
    if (heading !== null) {
      flush()
      current = {
        title: oneLine(heading[1].replace(/\*\*/g, '')),
        url: undefined,
        snippet: '',
      }
      continue
    }
    if (current === undefined) continue

    const urlLine = /^[-*]?\s*\*\*URL\*\*\s*:\s*(\S+)\s*$/i.exec(line.trim())
    if (urlLine !== null && current.url === undefined) {
      current.url = urlLine[1]
      continue
    }
    if (current.snippet.length > 0) continue

    const body = oneLine(line.replace(/^[-*]\s+/, '').replace(/^#{1,6}\s*/, '').replace(/\*\*/g, ''))
    if (body.length > 0) current.snippet = body.slice(0, SNIPPET_MAX_CHARS)
  }
  flush()
  return sources
}

/**
 * Decode a JSON-RPC response body that may be plain JSON or an SSE stream.
 *
 * @param text - the raw response text.
 * @param contentType - the response `content-type` header.
 * @returns the decoded JSON-RPC envelope.
 */
function decodeBody(text, contentType) {
  if (/text\/event-stream/i.test(contentType)) {
    const payloads = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]')
    if (payloads.length === 0) throw new Error('AnySearch returned an empty event stream')
    return JSON.parse(payloads[payloads.length - 1])
  }
  return JSON.parse(text)
}

/** Error carrying a machine-readable code the web seam can surface. */
class AnySearchError extends Error {
  /** @param message - human-readable detail. @param code - routable code. */
  constructor(message, code) {
    super(message)
    this.name = 'AnySearchError'
    this.code = code
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The AnySearch-backed search provider. */
class AnySearchSearchProvider {
  /** Provider id used by `web.searchProvider`. */
  id = PROVIDER_ID

  /**
   * @param options - resolved settings.
   */
  constructor(options) {
    this.endpoint = options.endpoint
    this.apiKey = options.apiKey
    this.client = options.client
    this.timeoutMs = options.timeoutMs
    this.maxAttempts = options.maxAttempts
    this.retryDelayMs = options.retryDelayMs
  }

  /** @returns whether an endpoint and credential are both configured. */
  available() {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0 && URL.canParse(this.endpoint)
  }

  /**
   * Issue one JSON-RPC `tools/call` against the AnySearch MCP endpoint.
   *
   * @param args - the AnySearch `search` tool arguments.
   * @param signal - optional caller cancellation.
   * @returns the AnySearch payload plus its request id.
   */
  async call(args, signal) {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: args },
    })

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      const forwardAbort = () => controller.abort()
      signal?.addEventListener?.('abort', forwardAbort)
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'X-Anysearch-Client': this.client,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body,
          signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) {
          const retryable = response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500
          if (retryable && attempt < this.maxAttempts) {
            await delay(this.retryDelayMs * attempt)
            continue
          }
          throw new AnySearchError(
            `AnySearch HTTP ${response.status}: ${oneLine(text).slice(0, 300)}`,
            retryable ? 'WEB_PROVIDER_RATE_LIMITED' : 'WEB_PROVIDER_ERROR',
          )
        }
        const envelope = decodeBody(text, response.headers.get('content-type') ?? '')
        if (envelope.error !== undefined) {
          throw new AnySearchError(
            `AnySearch JSON-RPC error ${envelope.error.code ?? ''}: ${oneLine(String(envelope.error.message ?? ''))}`.trim(),
            'WEB_PROVIDER_ERROR',
          )
        }
        const result = envelope.result ?? {}
        const textPart = Array.isArray(result.content)
          ? result.content.find((item) => item?.type === 'text' && typeof item.text === 'string')
          : undefined
        if (textPart === undefined) {
          throw new AnySearchError('AnySearch returned no text content block', 'WEB_PROVIDER_ERROR')
        }
        return {
          text: textPart.text,
          requestId: result._meta?.request_id,
        }
      } catch (error) {
        if (error instanceof AnySearchError) throw error
        if (controller.signal.aborted && signal?.aborted !== true && attempt < this.maxAttempts) {
          await delay(this.retryDelayMs * attempt)
          continue
        }
        if (controller.signal.aborted) {
          throw new AnySearchError(`AnySearch search timed out after ${this.timeoutMs}ms`, 'WEB_PROVIDER_TIMEOUT')
        }
        throw new AnySearchError(`AnySearch request failed: ${oneLine(String(error?.message ?? error))}`, 'WEB_PROVIDER_ERROR')
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', forwardAbort)
      }
    }
    throw new AnySearchError('AnySearch search exhausted its attempts', 'WEB_PROVIDER_ERROR')
  }

  /**
   * Run one search.
   *
   * @param request - the seam request (query plus optional result limit).
   * @param signal - optional caller cancellation.
   * @returns normalized sources for the model-facing `web_search` tool.
   */
  async search(request, signal) {
    const requested = Number.isFinite(request.maxResults) ? Number(request.maxResults) : DEFAULT_MAX_RESULTS
    const maxResults = Math.min(Math.max(1, Math.trunc(requested)), ANYSEARCH_MAX_RESULTS)
    const payload = await this.call({ query: request.query, max_results: maxResults }, signal)
    const sources = parseSearchText(payload.text)
    if (sources.length === 0) {
      const fallback = oneLine(payload.text).slice(0, CONTENT_MAX_CHARS)
      return {
        ...(fallback.length > 0 ? { content: fallback } : {}),
        sources: [],
        truncated: false,
      }
    }
    return { sources, truncated: false }
  }
}

/**
 * Register the AnySearch provider with `ctx.web`.
 *
 * @param ctx - the plugin context; `web` is injected.
 * @param config - the Loader row config.
 */
export function apply(ctx, config = {}) {
  const provider = new AnySearchSearchProvider({
    endpoint: readValue(config.endpoint, DEFAULT_ENDPOINT),
    apiKey: resolveApiKey(config.apiKey),
    client: readValue(config.client, DEFAULT_CLIENT),
    timeoutMs: readValue(config.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxAttempts: Math.max(1, readValue(config.maxAttempts, DEFAULT_MAX_ATTEMPTS)),
    retryDelayMs: readValue(config.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
  })
  ctx.web.registerSearchProvider(provider)
}

export { AnySearchSearchProvider, PROVIDER_ID, parseSearchText }