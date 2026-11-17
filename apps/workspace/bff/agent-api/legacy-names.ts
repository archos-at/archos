// The MCP surface's old names, read beside the new ones: drop after release 2026-W48.

export const LEGACY_MODE_HEADER = 'x-piloti-mcp-mode'

export const LEGACY_SENSITIVE_SCOPE = 'piloti:sensitive'

const RENAMED_URI_PREFIXES: readonly (readonly [from: string, to: string])[] = [
  ['piloti://', 'workspace://'],
  ['ui://piloti/', 'ui://workspace/'],
]

export function canonicalUri(uri: string): string {
  for (const [from, to] of RENAMED_URI_PREFIXES) if (uri.startsWith(from)) return to + uri.slice(from.length)
  return uri
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function canonicalMessage(message: unknown): unknown {
  if (!isRecord(message) || !isRecord(message.params)) return message
  const { params } = message
  if (message.method === 'resources/read' && typeof params.uri === 'string' && canonicalUri(params.uri) !== params.uri) {
    return { ...message, params: { ...params, uri: canonicalUri(params.uri) } }
  }
  const notifications = params.notifications
  if (message.method === 'subscriptions/listen' && isRecord(notifications) && Array.isArray(notifications.resourceSubscriptions)) {
    const asked = notifications.resourceSubscriptions
    const resourceSubscriptions = asked.map((uri) => (typeof uri === 'string' ? canonicalUri(uri) : uri))
    if (resourceSubscriptions.every((uri, index) => uri === asked[index])) return message
    return { ...message, params: { ...params, notifications: { ...notifications, resourceSubscriptions } } }
  }
  return message
}

const MCP_NAME_HEADER = 'mcp-name'

export async function canonicalRequest(request: Request): Promise<Request> {
  let message: unknown
  try {
    message = JSON.parse(await request.clone().text())
  } catch {
    return request
  }
  const canonical = canonicalMessage(message)
  const name = request.headers.get(MCP_NAME_HEADER)
  const canonicalName = name === null ? null : canonicalUri(name)
  if (canonical === message && canonicalName === name) return request
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  if (canonicalName !== null) headers.set(MCP_NAME_HEADER, canonicalName)
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(canonical), signal: request.signal })
}
