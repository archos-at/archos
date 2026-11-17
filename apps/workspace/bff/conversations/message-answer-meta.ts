export const ANSWER_META_VERSION = 1

export const VERDICT_VALUE_MAX_CHARS = 60
export const SUMMARY_MAX_CHARS = 320
export const TOPIC_MAX_CHARS = 90
export const CONTEXT_MAX_CHARS = 160
const MAX_SUBJECT_CHARS = 200
const MAX_TAKEAWAYS = 5
const MAX_TEXT_CHARS = 300
const MAX_DETAIL_CHARS = 600
const MAX_REFERENCE_CHARS = 120

export const CALLOUT_KINDS = ['note', 'warning', 'deadline', 'tip'] as const
export type AnswerCalloutKind = (typeof CALLOUT_KINDS)[number]

export const LEGACY_CALLOUT_KIND: Readonly<Record<string, AnswerCalloutKind>> = {
  hinweis: 'note',
  achtung: 'warning',
  frist: 'deadline',
  tipp: 'tip',
}

export const ANSWER_KINDS = ['direct', 'walkthrough', 'ruling', 'handoff', 'work'] as const
export type AnswerKind = (typeof ANSWER_KINDS)[number]

export interface AnswerMetaReference {
  document: string
  section?: string
  edition?: string
}

export interface AnswerMetaVerdict {
  value: string
  subject: string
  reference?: AnswerMetaReference
}

export interface AnswerMetaTakeaway {
  text: string
  detail?: string
}

export const WORK_ITEMS_MAX = 6
export const WORK_TEXT_MAX_CHARS = 200
const WORK_REF_MAX_CHARS = 80
const WORK_WHO_MAX_CHARS = 80
const WORK_DUE_MAX_CHARS = 40

export interface AnswerMetaWorkItem {
  text: string
  ref?: string
  who?: string
  due?: string
}

export interface AnswerMetaWork {
  done?: AnswerMetaWorkItem[]
  proposed?: AnswerMetaWorkItem[]
  blocked?: AnswerMetaWorkItem[]
  next?: AnswerMetaWorkItem[]
}

export const WORK_SECTIONS = ['done', 'proposed', 'blocked', 'next'] as const
export type WorkSection = (typeof WORK_SECTIONS)[number]

export interface AnswerMetaCallout {
  kind: AnswerCalloutKind
  text: string
  title?: string
  detail?: string
}

export interface AnswerMeta {
  v: number
  kind?: AnswerKind
  summary?: string
  topic?: string
  context?: string
  verdict?: AnswerMetaVerdict
  takeaways?: AnswerMetaTakeaway[]
  callout?: AnswerMetaCallout
  work?: AnswerMetaWork
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

function sanitizeReference(input: unknown): AnswerMetaReference | undefined {
  if (!isRecord(input)) return undefined
  const document = cap(input.document, MAX_REFERENCE_CHARS)
  if (!document) return undefined
  const reference: AnswerMetaReference = { document }
  const section = cap(input.section, MAX_REFERENCE_CHARS)
  if (section) reference.section = section
  const edition = cap(input.edition, MAX_REFERENCE_CHARS)
  if (edition) reference.edition = edition
  return reference
}

function sanitizeVerdict(input: unknown): AnswerMetaVerdict | undefined {
  if (!isRecord(input)) return undefined
  const raw = typeof input.value === 'string' ? input.value.trim() : ''
  if (!raw || raw.length > VERDICT_VALUE_MAX_CHARS) return undefined
  const subject = cap(input.subject, MAX_SUBJECT_CHARS)
  if (!subject) return undefined
  const verdict: AnswerMetaVerdict = { value: raw, subject }
  const reference = sanitizeReference(input.reference)
  if (reference) verdict.reference = reference
  return verdict
}

function sanitizeTakeaways(input: unknown): AnswerMetaTakeaway[] | undefined {
  if (!Array.isArray(input)) return undefined
  const items: AnswerMetaTakeaway[] = []
  for (const raw of input) {
    if (items.length >= MAX_TAKEAWAYS) break
    if (!isRecord(raw)) continue
    const text = cap(raw.text, MAX_TEXT_CHARS)
    if (!text) continue
    const detail = cap(raw.detail, MAX_DETAIL_CHARS)
    items.push(detail ? { text, detail } : { text })
  }
  return items.length >= 2 ? items : undefined
}

function sanitizeWorkItems(input: unknown): AnswerMetaWorkItem[] | undefined {
  if (!Array.isArray(input)) return undefined
  const items: AnswerMetaWorkItem[] = []
  for (const raw of input) {
    if (items.length >= WORK_ITEMS_MAX) break
    if (!isRecord(raw)) continue
    const text = cap(raw.text, WORK_TEXT_MAX_CHARS)
    if (!text) continue
    const item: AnswerMetaWorkItem = { text }
    const ref = cap(raw.ref, WORK_REF_MAX_CHARS)
    if (ref) item.ref = ref
    const who = cap(raw.who, WORK_WHO_MAX_CHARS)
    if (who) item.who = who
    const due = cap(raw.due, WORK_DUE_MAX_CHARS)
    if (due) item.due = due
    items.push(item)
  }
  return items.length > 0 ? items : undefined
}

function sanitizeWork(input: unknown): AnswerMetaWork | undefined {
  if (!isRecord(input)) return undefined
  const work: AnswerMetaWork = {}
  for (const section of WORK_SECTIONS) {
    const items = sanitizeWorkItems(input[section])
    if (items) work[section] = items
  }
  return Object.keys(work).length > 0 ? work : undefined
}

function sanitizeKind(input: unknown): AnswerKind | undefined {
  if (typeof input !== 'string') return undefined
  const kind = input.trim()
  if (!kind) return undefined
  return (ANSWER_KINDS as readonly string[]).includes(kind) ? (kind as AnswerKind) : 'walkthrough'
}

function sanitizeCallout(input: unknown): AnswerMetaCallout | undefined {
  if (!isRecord(input)) return undefined
  const raw = typeof input.kind === 'string' ? input.kind : ''
  const kind = Object.hasOwn(LEGACY_CALLOUT_KIND, raw) ? LEGACY_CALLOUT_KIND[raw]! : raw
  if (!(CALLOUT_KINDS as readonly string[]).includes(kind)) return undefined
  const text = cap(input.text, MAX_TEXT_CHARS)
  if (!text) return undefined
  const callout: AnswerMetaCallout = { kind: kind as AnswerCalloutKind, text }
  const title = cap(input.title, MAX_TEXT_CHARS)
  if (title) callout.title = title
  const detail = cap(input.detail, MAX_DETAIL_CHARS)
  if (detail) callout.detail = detail
  return callout
}

export function sanitizeAnswerMeta(input: unknown): AnswerMeta | null {
  if (!isRecord(input)) return null

  const rawSummary = typeof input.summary === 'string' ? input.summary.trim() : ''
  const summary = rawSummary && rawSummary.length <= SUMMARY_MAX_CHARS ? rawSummary : undefined
  const rawTopic = typeof input.topic === 'string' ? input.topic.trim() : ''
  const topic = rawTopic && rawTopic.length <= TOPIC_MAX_CHARS ? rawTopic : undefined
  const rawContext = typeof input.context === 'string' ? input.context.trim() : ''
  const context = rawContext && rawContext.length <= CONTEXT_MAX_CHARS ? rawContext : undefined
  const kind = sanitizeKind(input.kind)
  const verdict = kind && kind !== 'ruling' ? undefined : sanitizeVerdict(input.verdict)
  const takeaways = sanitizeTakeaways(input.takeaways)
  const callout = sanitizeCallout(input.callout)
  const work = kind === 'work' ? sanitizeWork(input.work) : undefined
  if (!kind && !summary && !topic && !context && !verdict && !takeaways && !callout) return null

  const version = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : ANSWER_META_VERSION
  const meta: AnswerMeta = { v: version }
  if (kind) meta.kind = kind
  if (summary) meta.summary = summary
  if (topic) meta.topic = topic
  if (context) meta.context = context
  if (verdict) meta.verdict = verdict
  if (takeaways) meta.takeaways = takeaways
  if (callout) meta.callout = callout
  if (work) meta.work = work
  return meta
}
