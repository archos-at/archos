import { modernizeTurnEventKey } from './legacy-turn-event'

export interface RetrievalLedgerDoc {
  name: string
  title?: string
  detail?: string
  shelf?: string
  repeat?: boolean
}

export interface RetrievalLedgerEntry {
  index: number
  key: string
  tools: string[]
  corpora: string[]
  query?: string
  reason?: string
  docs: RetrievalLedgerDoc[]
  newDocs: string[]
  hits: number
  documents: number
}

export type RetrievalLedger = RetrievalLedgerEntry[]

const MAX_ROUNDS = 12
const MAX_QUERY_CHARS = 32
const MAX_REASON_CHARS = 160
const MAX_KEY_CHARS = 64
const MAX_TOOL_CHARS = 64
const MAX_CORPUS_CHARS = 32
const MAX_DOCS_PER_ROUND = 100
const MAX_NEW_DOCS = 100
const MAX_TOOLS = 32
const MAX_CORPORA = 8
const MAX_NAME_CHARS = 256
const MAX_TITLE_CHARS = 256
const MAX_DETAIL_CHARS = 128
const MAX_SHELF_CHARS = 64

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

const capList = (value: unknown, maxItems: number, maxChars: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const raw of value) {
    if (items.length >= maxItems) break
    const text = cap(raw, maxChars)
    if (text !== undefined) items.push(text)
  }
  return items.length > 0 ? items : undefined
}

const int = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined

const docKey = (name: string): string => name.trim().toLowerCase()

function sanitizeDoc(input: unknown): RetrievalLedgerDoc | undefined {
  if (!isRecord(input)) return undefined
  const name = cap(input.name, MAX_NAME_CHARS)
  if (!name) return undefined
  const doc: RetrievalLedgerDoc = { name }
  const title = cap(input.title, MAX_TITLE_CHARS)
  if (title !== undefined) doc.title = title
  const detail = cap(input.detail, MAX_DETAIL_CHARS)
  if (detail !== undefined) doc.detail = detail
  const shelf = cap(input.shelf, MAX_SHELF_CHARS)
  if (shelf !== undefined) doc.shelf = shelf
  if (typeof input.repeat === 'boolean') doc.repeat = input.repeat
  return doc
}

function sanitizeEntry(input: unknown): RetrievalLedgerEntry | undefined {
  if (!isRecord(input)) return undefined
  const index = int(input.index)
  if (index === undefined) return undefined
  const docs: RetrievalLedgerDoc[] = []
  if (Array.isArray(input.docs)) {
    for (const raw of input.docs) {
      if (docs.length >= MAX_DOCS_PER_ROUND) break
      const doc = sanitizeDoc(raw)
      if (doc) docs.push(doc)
    }
  }
  const names = new Set(docs.map((doc) => docKey(doc.name)))
  const entry: RetrievalLedgerEntry = {
    index,
    key: modernizeTurnEventKey(cap(input.key, MAX_KEY_CHARS) ?? ''),
    tools: capList(input.tools, MAX_TOOLS, MAX_TOOL_CHARS) ?? [],
    corpora: capList(input.corpora, MAX_CORPORA, MAX_CORPUS_CHARS) ?? [],
    docs,
    newDocs:
      capList(input.new_docs, MAX_NEW_DOCS, MAX_NAME_CHARS)?.filter((name) => names.has(docKey(name))) ?? [],
    hits: docs.length,
    documents: names.size,
  }
  const query = cap(input.query, MAX_QUERY_CHARS)
  if (query !== undefined) entry.query = query
  const reason = cap(input.reason, MAX_REASON_CHARS)
  if (reason !== undefined) entry.reason = reason
  return entry
}

export function sanitizeRetrievalLedger(input: unknown): RetrievalLedger | null {
  if (!Array.isArray(input)) return null
  const entries: RetrievalLedger = []
  for (const raw of input) {
    if (entries.length >= MAX_ROUNDS) break
    const entry = sanitizeEntry(raw)
    if (entry) entries.push(entry)
  }
  return entries.length > 0 ? entries : null
}
