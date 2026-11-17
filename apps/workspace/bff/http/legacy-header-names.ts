// drop after release 2026-W48
const RENAMED_HEADERS: Record<string, string> = { 'x-chat-mode': 'x-aiq-mode' }

export function legacyHeaderName(name: string): string {
  return RENAMED_HEADERS[name.toLowerCase()] ?? name.replace(/^x-/i, (prefix) => `${prefix}grid-`)
}

export function readHeader(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(legacyHeaderName(name))
}

export function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name) || headers.has(legacyHeaderName(name))
}

export function withLegacyHeaderNames(headers: Record<string, string>): Record<string, string> {
  const legacy = Object.fromEntries(Object.entries(headers).map(([name, value]) => [legacyHeaderName(name), value]))
  return { ...headers, ...legacy }
}
