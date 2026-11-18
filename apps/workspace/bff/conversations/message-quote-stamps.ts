export type QuoteStampStatus = 'verbatim' | 'not_found' | 'unchecked'

export interface QuoteStamp {
  text: string
  status: QuoteStampStatus
  number?: number
  title?: string
  fileName?: string
  page?: number
  clause?: string
  url?: string
}

const STATUSES: ReadonlySet<string> = new Set(['verbatim', 'not_found', 'unchecked'])
const MAX_STAMPS = 40
const MAX_TEXT_CHARS = 1200
const MAX_TITLE_CHARS = 256
const MAX_NAME_CHARS = 256
const MAX_CLAUSE_CHARS = 64
const MAX_URL_CHARS = 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined

function sanitizeStamp(input: unknown): QuoteStamp | undefined {
  if (!isRecord(input)) return undefined
  const text = cap(input.text, MAX_TEXT_CHARS)
  const status = typeof input.status === 'string' && STATUSES.has(input.status) ? (input.status as QuoteStampStatus) : undefined
  if (!text || !status) return undefined
  const stamp: QuoteStamp = { text, status }
  const number = positive(input.number)
  if (number !== undefined) stamp.number = number
  const title = cap(input.title, MAX_TITLE_CHARS)
  if (title) stamp.title = title
  const fileName = cap(input.fileName ?? input.file_name, MAX_NAME_CHARS)
  if (fileName) stamp.fileName = fileName
  const page = positive(input.page)
  if (page !== undefined) stamp.page = page
  const clause = cap(input.clause ?? input.punkt, MAX_CLAUSE_CHARS)
  if (clause) stamp.clause = clause
  const url = cap(input.url, MAX_URL_CHARS)
  if (url && /^https?:\/\//i.test(url)) stamp.url = url
  return stamp
}

export function sanitizeQuoteStamps(input: unknown): QuoteStamp[] | null {
  if (!Array.isArray(input)) return null
  const stamps: QuoteStamp[] = []
  for (const raw of input) {
    if (stamps.length >= MAX_STAMPS) break
    const stamp = sanitizeStamp(raw)
    if (stamp) stamps.push(stamp)
  }
  return stamps.length > 0 ? stamps : null
}

export const normalizeQuote = (text: string): string =>
  text
    .replace(/==/g, '')
    .replace(/[„“”"‚‘’'«»]/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .toLocaleLowerCase('de')

export function stampForQuote(stamps: readonly QuoteStamp[] | undefined, quote: string, number?: number): QuoteStamp | null {
  if (!stamps || stamps.length === 0) return null
  const wanted = normalizeQuote(quote)
  if (!wanted) return null
  const matches = stamps.filter((stamp) => {
    const have = normalizeQuote(stamp.text)
    return have.length > 0 && (wanted.includes(have) || have.includes(wanted))
  })
  return matches.find((stamp) => number !== undefined && stamp.number === number) ?? matches[0] ?? null
}
