import type { RevisionLinks, RevisionHistoryEntry, RevisionRef } from '@/lib/documents/revision-links'
import type { RevisionFacts } from '@/lib/documents/revision-facts'
import type { DocumentVersionState, DocumentVersionView } from '@/lib/documents/lifecycle-types'
import type { DocumentReadFamily } from '@/lib/documents/document-status'
import { parseRevisionName } from '@/lib/documents/revision-series'

const isoDay = /^(\d{4})-(\d{2})-(\d{2})/

export type RevisionTag = { kind: 'index'; text: string } | { kind: 'date'; text: string }

export function revisionTag(filename: string, titleBlock?: RevisionFacts | null): RevisionTag | null {
  const printed = titleBlock?.revision?.trim()
  if (printed) return { kind: 'index', text: /^index\b/i.test(printed) ? printed : `Index ${printed}` }
  const revision = parseRevisionName(filename)
  if (revision?.index) {
    return { kind: 'index', text: revision.index.kind === 'letter' ? `Index ${revision.index.value}` : `v${revision.index.value}` }
  }
  const date = titleBlock?.revisionDate?.trim() || revision?.date
  if (!date) return null
  const day = isoDay.exec(date)
  return { kind: 'date', text: day ? `${day[3]}.${day[2]}.${day[1]}` : date }
}

export function changeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-–—•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

export function hasLinkedRevisions(facts: RevisionLinks | null | undefined): boolean {
  if (!facts) return false
  return (
    facts.supersededBy !== null ||
    facts.supersedes.length > 0 ||
    (facts.history?.length ?? 0) > 0 ||
    facts.suggestion !== null ||
    facts.changeSummary !== null
  )
}

export function showsRevisionsSection(input: {
  facts: RevisionLinks | null | undefined
  versionCount: number | null | undefined
  hasViewer: boolean
}): boolean {
  return input.hasViewer || hasLinkedRevisions(input.facts) || (input.versionCount ?? 1) > 1
}

const PENDING_STATES: ReadonlySet<DocumentVersionState> = new Set([
  'draft',
  'in_review',
  'changes_requested',
  'approved',
])

export function isPendingVersion(version: Pick<DocumentVersionView, 'state'>): boolean {
  return PENDING_STATES.has(version.state)
}

export interface VersionAct {
  key: 'uploaded' | 'submitted' | 'approved' | 'published' | 'changesRequested' | 'rejected'
  actor: string
  when: string
}

const MILESTONES = [
  { key: 'submitted', by: 'submittedBy', at: 'submittedAt' },
  { key: 'approved', by: 'approvedBy', at: 'approvedAt' },
  { key: 'published', by: 'publishedBy', at: 'publishedAt' },
] as const satisfies readonly {
  key: VersionAct['key']
  by: keyof DocumentVersionView
  at: keyof DocumentVersionView
}[]

const REFUSAL_MILESTONES = [
  { state: 'changes_requested', key: 'changesRequested' },
  { state: 'rejected', key: 'rejected' },
] as const satisfies readonly { state: DocumentVersionState; key: VersionAct['key'] }[]

export function bornPublished(version: Pick<DocumentVersionView, 'state' | 'submittedBy'>): boolean {
  return (version.state === 'published' || version.state === 'superseded') && version.submittedBy === null
}

export function versionActs(version: DocumentVersionView): VersionAct[] {
  if (bornPublished(version)) return []
  const acts: VersionAct[] = MILESTONES.flatMap(({ key, by, at }) => {
    const actor = version[by]
    const when = version[at]
    return typeof actor === 'string' && typeof when === 'string' ? [{ key, actor, when }] : []
  })
  const approved = acts.find((act) => act.key === 'approved')
  const published = acts.find((act) => act.key === 'published')
  if (approved && published && approved.actor === published.actor && approved.when === published.when) {
    acts.splice(acts.indexOf(published), 1)
  }
  const refusal = REFUSAL_MILESTONES.find((row) => row.state === version.state)
  if (refusal && version.reviewedBy && version.reviewedAt) {
    acts.push({ key: refusal.key, actor: version.reviewedBy, when: version.reviewedAt })
  }
  return acts
}

export function latestAct(version: DocumentVersionView): VersionAct {
  const acts = versionActs(version)
  const latest = acts.reduce<VersionAct | null>(
    (best, act) => (best === null || Date.parse(act.when) >= Date.parse(best.when) ? act : best),
    null,
  )
  return latest ?? { key: 'uploaded', actor: version.createdBy, when: version.createdAt }
}

export const versionContentUrl = (documentId: string, versionId: string): string =>
  `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/content`

export interface VersionRow {
  kind: 'version'
  key: string
  at: string
  version: DocumentVersionView
  predecessor: DocumentVersionView | null
  current: boolean
  newest: boolean
  number: number
}

export interface HeadRow {
  kind: 'head'
  key: string
  at: string | null
  current: boolean
  newest: true
  number: number
}

export interface LinkedRow {
  kind: 'linked'
  key: string
  at: string | null
  entry: RevisionHistoryEntry
  direct: boolean
  number: number
}

export interface NewerRow {
  kind: 'newer'
  key: string
  at: null
  ref: RevisionRef
  number: number
}

export type TimelineRow = VersionRow | HeadRow | LinkedRow | NewerRow

export interface BuildTimelineInput {
  versions: readonly DocumentVersionView[]
  publishedVersionId: string | null
  history: readonly RevisionHistoryEntry[]
  directIds: ReadonlySet<string>
  headAt: string | null
  newer?: RevisionRef | null
  newestRead?: DocumentReadFamily
  predecessorStandsIn?: boolean
}

const time = (value: string | null): number => {
  if (value === null) return Number.NaN
  return Date.parse(value)
}

function byNewest(a: Unnumbered, b: Unnumbered): number {
  const left = time(a.at)
  const right = time(b.at)
  const leftKnown = !Number.isNaN(left)
  const rightKnown = !Number.isNaN(right)
  if (leftKnown && rightKnown && left !== right) return right - left
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
  if (a.kind === 'version' && b.kind === 'version') return b.version.versionNumber - a.version.versionNumber
  if (a.kind !== 'linked' && b.kind === 'linked') return -1
  if (a.kind === 'linked' && b.kind !== 'linked') return 1
  return 0
}

export function buildRevisionTimeline(input: BuildTimelineInput): TimelineRow[] {
  const { versions, history, directIds, headAt, newer = null } = input
  const replaced = newer !== null
  const read = input.newestRead ?? 'readable'
  const byNumber = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)
  const answering = answeringVersionId(byNumber, input.publishedVersionId, read, input.predecessorStandsIn ?? true)
  const own: Unnumbered[] =
    byNumber.length === 0
      ? [{ kind: 'head', key: 'head', at: headAt, current: !replaced && read === 'readable', newest: true }]
      : byNumber.map((version, index) => ({
          kind: 'version',
          key: `version:${version.id}`,
          at: version.createdAt,
          version,
          predecessor: byNumber[index + 1] ?? null,
          current: !replaced && version.id === answering,
          newest: index === 0,
        }))
  const linked: Unnumbered[] = history.map((entry) => ({
    kind: 'linked',
    key: `linked:${entry.id}`,
    at: entry.createdAt,
    entry,
    direct: directIds.has(entry.id),
  }))
  const top: Unnumbered[] = newer ? [{ kind: 'newer', key: `newer:${newer.id}`, at: null, ref: newer }] : []
  const ordered = [...top, ...[...own, ...linked].sort(byNewest)]
  return ordered.map((row, index) => ({ ...row, number: ordered.length - index }) as TimelineRow)
}

function answeringVersionId(
  byNumber: readonly DocumentVersionView[],
  publishedVersionId: string | null,
  read: DocumentReadFamily,
  predecessorStandsIn: boolean,
): string | null {
  const [newest, previous] = byNumber
  if (read === 'readable' || newest === undefined || newest.id !== publishedVersionId) return publishedVersionId
  if (!predecessorStandsIn || previous === undefined || previous.state !== 'superseded') return null
  return previous.id
}

type WithoutNumber<Row> = Row extends unknown ? Omit<Row, 'number'> : never
type Unnumbered = WithoutNumber<TimelineRow>

export function ownNewestRow(rows: readonly TimelineRow[]): VersionRow | HeadRow | null {
  return rows.find((row): row is VersionRow | HeadRow => row.kind === 'head' || (row.kind === 'version' && row.newest)) ?? null
}

export function numberOfVersion(rows: readonly TimelineRow[], versionId: string): number | null {
  const row = rows.find((candidate) => candidate.kind === 'version' && candidate.version.id === versionId)
  return row?.number ?? null
}
