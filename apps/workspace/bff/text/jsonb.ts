// eslint-disable-next-line no-control-regex
const JSONB_UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function stripJsonNullBytes<T>(value: T): T {
  if (typeof value === 'string') return value.replace(JSONB_UNSTORABLE, '') as T
  if (Array.isArray(value)) return value.map(stripJsonNullBytes) as T
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key.replace(JSONB_UNSTORABLE, '')] = stripJsonNullBytes(entry)
    }
    return out as T
  }
  return value
}
