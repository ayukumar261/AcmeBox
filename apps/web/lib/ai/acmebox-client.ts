/**
 * Thin HTTP client for the AcmeBox REST API (apps/api, Effect + Postgres on
 * :3000, no auth). This is the web equivalent of the in-process dispatch the
 * Python/MCP harness uses in apps/mcp/src/runtime.ts — except here each agent
 * tool reaches the API over HTTP.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

export interface ApiCall {
  method: HttpMethod
  /** Path template with `:param` placeholders, e.g. `/customers/:customerId`. */
  pathTemplate: string
  /** Values for the `:param` placeholders. */
  path?: Record<string, string | number>
  /** Query-string parameters (omitted when empty). */
  urlParams?: Record<string, unknown>
  /** JSON request body. */
  payload?: unknown
}

export type ApiResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: unknown }

const BASE_URL = process.env.ACMEBOX_API_BASE_URL ?? "http://localhost:3000"

function interpolate(template: string, path?: Record<string, string | number>): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = path?.[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter "${key}" for ${template}`)
    }
    return encodeURIComponent(String(value))
  })
}

function buildQuery(urlParams?: Record<string, unknown>): string {
  if (!urlParams) return ""
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(urlParams)) {
    if (value === undefined || value === null || value === "") continue
    qs.append(key, String(value))
  }
  const str = qs.toString()
  return str ? `?${str}` : ""
}

/**
 * Execute a single API call. Never throws for HTTP errors — returns a structured
 * result so callers (the agent tools) can hand the error back to the model.
 */
export async function callAcmebox(call: ApiCall): Promise<ApiResult> {
  const url = BASE_URL + interpolate(call.pathTemplate, call.path) + buildQuery(call.urlParams)

  const res = await fetch(url, {
    method: call.method,
    headers: call.payload !== undefined ? { "content-type": "application/json" } : undefined,
    body: call.payload !== undefined ? JSON.stringify(call.payload) : undefined,
  })

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) return { ok: false, status: res.status, error: data ?? res.statusText }
  return { ok: true, status: res.status, data }
}
