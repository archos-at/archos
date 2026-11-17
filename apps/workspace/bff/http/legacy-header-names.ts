export function legacyHeaderName(name: string): string {
  return name.replace(/^x-/i, (prefix) => `${prefix}grid-`)
}

export function readHeader(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(legacyHeaderName(name))
}

export function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name) || headers.has(legacyHeaderName(name))
}
