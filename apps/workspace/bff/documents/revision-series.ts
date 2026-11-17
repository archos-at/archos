import { documentNameKey } from './name-match'

export interface RevisionIndex {
  kind: 'letter' | 'number'
  value: string
  rank: number
}

export interface RevisionName {
  key: string
  index: RevisionIndex | null
  date: string | null
}

const SEP = '[ _.\\-]'
const KEYWORD_INDEX = new RegExp(
  `(^|${SEP})(?:index|idx|ind|rev|revision|ver|version|v)\\.?${SEP}?([a-z]|\\d{1,3})(?=$|${SEP})`,
  'i'
)
const SHEET_NUMBER_LETTER = /^([A-Za-z]{1,3}[-_ ]?\d{2,4})[ _.-]([A-Z])(?=[ _.-]\S)/
const ISO_DATE = new RegExp(
  `(^|${SEP})(?:stand${SEP}*)?(20\\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\\d|3[01])(?=$|${SEP})`,
  'i'
)
const DOTTED_DATE = new RegExp(`(^|${SEP})(?:stand${SEP}*)?(0[1-9]|[12]\\d|3[01])\\.(0[1-9]|1[0-2])\\.(20\\d{2})(?=$|${SEP})`, 'i')
const SHORT_DATE_START = /^(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=[ _.-])/
const SHORT_DATE_END = new RegExp(`${SEP}(\\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])$`)

function splitExtension(filename: string): { stem: string; extension: string } {
  const match = /^(.*)\.([a-z0-9]{1,5})$/i.exec(filename.trim())
  return match ? { stem: match[1], extension: match[2].toLowerCase() } : { stem: filename.trim(), extension: '' }
}

function indexOf(raw: string): RevisionIndex {
  if (/^\d+$/.test(raw)) {
    const number = Number.parseInt(raw, 10)
    return { kind: 'number', value: String(number), rank: number }
  }
  const letter = raw.toUpperCase()
  return { kind: 'letter', value: letter, rank: letter.charCodeAt(0) - 64 }
}

function seriesKey(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[\s_.]+/g, ' ')
    .replace(/\s*-\s*(?=\s|$)/g, ' ')
    .replace(/(^|\s)-\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseRevisionName(filename: string): RevisionName | null {
  let { stem } = splitExtension(filename)
  let index: RevisionIndex | null = null
  let date: string | null = null

  const cut = (match: RegExpExecArray, keepLead: boolean) => {
    const lead = keepLead ? (match[1] ?? '') : ''
    stem = stem.slice(0, match.index) + lead + ' ' + stem.slice(match.index + match[0].length)
  }

  let match = ISO_DATE.exec(stem)
  if (match) {
    date = `${match[2]}-${match[3]}-${match[4]}`
    cut(match, true)
  } else if ((match = DOTTED_DATE.exec(stem))) {
    date = `${match[4]}-${match[3]}-${match[2]}`
    cut(match, true)
  } else if ((match = SHORT_DATE_START.exec(stem))) {
    date = `20${match[1]}-${match[2]}-${match[3]}`
    cut(match, false)
  } else if ((match = SHORT_DATE_END.exec(stem))) {
    date = `20${match[1]}-${match[2]}-${match[3]}`
    cut(match, false)
  }

  if ((match = KEYWORD_INDEX.exec(stem))) {
    index = indexOf(match[2])
    cut(match, true)
  } else if ((match = SHEET_NUMBER_LETTER.exec(stem))) {
    index = indexOf(match[2])
    stem = match[1] + ' ' + stem.slice(match[0].length)
  }

  if (!index && !date) return null
  const key = seriesKey(stem)
  return key ? { key, index, date } : null
}

export interface RevisionSeriesMember<T> {
  item: T
  revision: RevisionName
}

export interface RevisionSeries<T> {
  key: string
  current: RevisionSeriesMember<T>
  older: RevisionSeriesMember<T>[]
}

export function newestFirst<T extends { createdAt?: string | null }>(members: RevisionSeriesMember<T>[]): RevisionSeriesMember<T>[] {
  const kinds = new Set(members.map((member) => member.revision.index?.kind ?? 'none'))
  const indexLeads = kinds.size === 1 && !kinds.has('none')
  const tuple = (member: RevisionSeriesMember<T>): [number, string, number, string] => [
    indexLeads ? (member.revision.index?.rank ?? 0) : 0,
    member.revision.date ?? '',
    member.revision.index?.rank ?? 0,
    member.item.createdAt ?? '',
  ]
  return [...members].sort((a, b) => {
    const ta = tuple(a)
    const tb = tuple(b)
    for (let i = 0; i < ta.length; i += 1) {
      if (ta[i] !== tb[i]) return ta[i] < tb[i] ? 1 : -1
    }
    return 0
  })
}

function signature(revision: RevisionName): string {
  return `${revision.index?.kind ?? ''}:${revision.index?.value ?? ''}:${revision.date ?? ''}`
}

export function findRevisionSeries<T extends { filename: string; createdAt?: string | null }>(
  items: readonly T[]
): RevisionSeries<T>[] {
  const groups = new Map<string, RevisionSeriesMember<T>[]>()
  for (const item of items) {
    const revision = parseRevisionName(item.filename)
    if (!revision) continue
    const key = `${revision.key}.${splitExtension(item.filename).extension}`
    const bucket = groups.get(key)
    if (bucket) bucket.push({ item, revision })
    else groups.set(key, [{ item, revision }])
  }
  const series: RevisionSeries<T>[] = []
  for (const [key, members] of groups) {
    if (new Set(members.map((member) => signature(member.revision))).size < 2) continue
    const ordered = newestFirst(members)
    series.push({ key, current: ordered[0], older: ordered.slice(1) })
  }
  return series.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function revisionLabel(revision: RevisionName): string {
  const parts: string[] = []
  if (revision.index) parts.push(revision.index.kind === 'letter' ? `Index ${revision.index.value}` : `v${revision.index.value}`)
  if (revision.date) {
    const [year, month, day] = revision.date.split('-')
    parts.push(`${day}.${month}.${year}`)
  }
  return parts.join(' · ')
}

export function revisionSeriesKeyOf(filename: string): string | null {
  const revision = parseRevisionName(filename)
  return revision ? `${revision.key}.${splitExtension(filename).extension}` : null
}

export interface RevisionCandidate<T> {
  candidates: Array<{ item: T; label: string }>
  newer: boolean
  unambiguous: boolean
}

export const REVISION_MAX_CANDIDATES = 5

export function findRevisionCandidate<T extends { filename: string; createdAt?: string | null }>(
  droppedName: string,
  current: readonly T[]
): RevisionCandidate<T> | null {
  const dropped = parseRevisionName(droppedName)
  const key = revisionSeriesKeyOf(droppedName)
  if (!dropped || !key) return null
  const droppedKey = documentNameKey(droppedName)
  const members: RevisionSeriesMember<T>[] = []
  for (const item of current) {
    if (documentNameKey(item.filename) === droppedKey) return null
    const revision = parseRevisionName(item.filename)
    if (revision && revisionSeriesKeyOf(item.filename) === key) members.push({ item, revision })
  }
  if (members.length === 0) return null
  const ordered = newestFirst(members)
  const newest = ordered[0]
  const arrival: RevisionSeriesMember<{ filename: string; createdAt: string }> = {
    item: { filename: droppedName, createdAt: '\uffff' },
    revision: dropped,
  }
  const ranked = newestFirst<{ filename: string; createdAt?: string | null }>([...members, arrival])
  const newer = ranked[0] === arrival && signature(newest.revision) !== signature(dropped)
  return {
    candidates: ordered
      .slice(0, REVISION_MAX_CANDIDATES)
      .map((member) => ({ item: member.item, label: revisionLabel(member.revision) })),
    newer,
    unambiguous: newer && members.length === 1,
  }
}
