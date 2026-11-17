export const SENSITIVE_PARAMS = ['sig', 'token', 'secret', 'key', 'code', 'state'] as const

const SENSITIVE = new Set<string>(SENSITIVE_PARAMS)

const QUERY_PART = /\?[^\s"'<>#]*/g
const FRAGMENT_PART = /#[^\s"'<>]*=[^\s"'<>]*/g

const MAX_DEPTH = 8

const nameOf = (pair: string): string => {
  const raw = pair.split('=')[0] ?? ''
  try {
    return decodeURIComponent(raw).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

const TRAILING_PUNCTUATION = /[)\]}.,;:!]+$/

const filterPairs = (matched: string, lead: '?' | '#'): string => {
  const trailing = TRAILING_PUNCTUATION.exec(matched)?.[0] ?? ''
  const part = trailing ? matched.slice(0, -trailing.length) : matched
  const pairs = part.slice(1).split('&')
  const kept = pairs.filter((pair) => !SENSITIVE.has(nameOf(pair)))
  if (kept.length === pairs.length) return matched
  return (kept.length === 0 ? '' : `${lead}${kept.join('&')}`) + trailing
}

export const scrubUrlString = (value: string): string => {
  if (!value.includes('?') && !value.includes('#')) return value
  return value
    .replace(QUERY_PART, (part) => filterPairs(part, '?'))
    .replace(FRAGMENT_PART, (part) => filterPairs(part, '#'))
}

const scrubValue = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') return scrubUrlString(value)
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  if (Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubValue(item, depth + 1)]),
  )
}

type Bag = Record<string, unknown>

interface ScrubbableEvent {
  event?: string
  properties?: Bag
  $set?: Bag
  $set_once?: Bag
}

export const scrubServerEvent = <T extends ScrubbableEvent | null>(event: T): T => {
  if (!event) return event
  try {
    const next: ScrubbableEvent = { ...event }
    if (event.properties) next.properties = scrubValue(event.properties, 0) as Bag
    if (event.$set) next.$set = scrubValue(event.$set, 0) as Bag
    if (event.$set_once) next.$set_once = scrubValue(event.$set_once, 0) as Bag
    return next as T
  } catch (error) {
    console.debug('[posthog] could not scrub event; sending it without properties', error)
    const emptied: ScrubbableEvent = { ...event, properties: {} }
    delete emptied.$set
    delete emptied.$set_once
    return emptied as T
  }
}
