export const SENSITIVE_QUERY_KEYS = ['sig', 'token', 'secret', 'key', 'code', 'state'] as const

const KEY_PATTERN =
  '(?:[\\w.-]*[_-])?(?:' + [...SENSITIVE_QUERY_KEYS, 'signature', 'apikey', 'password'].join('|') + ')'

const SEPARATOR = '(?:[?&#]|%26|%3F|%23)'
const EQUALS = '(?:=|%3D)'
const VALUE = '(?:(?!%26|%23)[^&#\\s"\'<>)\\]])*'

const SENSITIVE_PARAM = new RegExp(`(${SEPARATOR})${KEY_PATTERN}${EQUALS}${VALUE}`, 'gi')

const OPENS_QUERY = /^(?:[?#]|%3F|%23)$/i
const NOTHING_LEFT = /([?#]|%3F|%23)(?:&|%26)+/gi
const DANGLING = new RegExp(`${SEPARATOR}+(?=$|[\\s"'<>)\\]])`, 'gi')

export const scrubSensitiveQuery = (text: string): string => {
  if (!/=|%3D/i.test(text)) return text
  const removed = text.replace(SENSITIVE_PARAM, (_match, separator: string) =>
    OPENS_QUERY.test(separator) ? separator : ''
  )
  if (removed === text) return text
  return removed.replace(NOTHING_LEFT, '$1').replace(DANGLING, '')
}

const MAX_DEPTH = 8

export const scrubDeep = <T>(value: T, depth = 0): T => {
  if (typeof value === 'string') return scrubSensitiveQuery(value) as T
  if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const scrubbed = scrubDeep(item, depth + 1)
      if (scrubbed !== item) changed = true
      return scrubbed
    })
    return (changed ? next : value) as T
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const scrubbed = scrubDeep(item, depth + 1)
    if (scrubbed !== item) changed = true
    next[key] = scrubbed
  }
  return (changed ? next : value) as T
}
