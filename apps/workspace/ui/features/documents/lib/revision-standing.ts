import type { DocumentReadFamily } from '@/lib/documents/document-status'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import {
  availableLifecycleGestures,
  lifecycleProgress,
  type DocumentBadgeState,
  type DocumentLifecycleViewer,
  type LifecycleProgress,
} from './document-lifecycle'
import { bornPublished, ownNewestRow, type TimelineRow } from '@/lib/documents/revision-timeline'

export type NextStepKind = 'submit' | 'approve' | 'revise' | 'publish'

export interface NextStep {
  kind: NextStepKind
  people: readonly string[]
  you: boolean
}

export type AnswerBasis =
  | { kind: 'this' }
  | { kind: 'older'; number: number }
  | { kind: 'newer'; number: number }
  | { kind: 'notYet' }
  | { kind: 'notYetRead' }
  | { kind: 'never' }
  | { kind: 'retired' }

export interface RevisionStanding {
  number: number | null
  state: DocumentBadgeState | null
  progress: LifecycleProgress | null
  stage: number | null
  nextStep: NextStep | null
  answer: AnswerBasis
}

export interface StandingInput {
  rows: readonly TimelineRow[]
  newest: DocumentVersionView | null
  lifecycle: 'active' | 'archived'
  reviewerUserIds?: readonly string[]
  viewer?: DocumentLifecycleViewer
  newestRead?: DocumentReadFamily
}

const WALKED_STATES: ReadonlySet<DocumentVersionView['state']> = new Set([
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'rejected',
])

export function revisionStanding({
  rows,
  newest,
  lifecycle,
  reviewerUserIds = [],
  viewer,
  newestRead = 'readable',
}: StandingInput): RevisionStanding {
  const own = ownNewestRow(rows)
  const newer = rows.find((row) => row.kind === 'newer') ?? null
  const state = headerState(newest, lifecycle, newer !== null)
  const tracked = newest !== null && state !== null && state !== 'archived' && state !== 'superseded' && WALKED_STATES.has(newest.state)
  const progress = tracked ? lifecycleProgress(newest, lifecycle) : null
  return {
    number: own?.number ?? null,
    state,
    progress,
    stage: progress ? Math.max(0, progress.reached - 1) : null,
    nextStep: state === 'archived' || newer !== null ? null : nextStepOf(newest, lifecycle, reviewerUserIds, viewer),
    answer: answerBasis(rows, newest, lifecycle, newer?.number ?? null, newestRead),
  }
}

function headerState(
  newest: DocumentVersionView | null,
  lifecycle: 'active' | 'archived',
  replaced: boolean,
): DocumentBadgeState | null {
  if (lifecycle === 'archived') return 'archived'
  if (replaced) return 'superseded'
  if (newest === null || bornPublished(newest)) return null
  return newest.state
}

function answerBasis(
  rows: readonly TimelineRow[],
  newest: DocumentVersionView | null,
  lifecycle: 'active' | 'archived',
  newerNumber: number | null,
  read: DocumentReadFamily,
): AnswerBasis {
  if (lifecycle === 'archived') return { kind: 'retired' }
  if (newerNumber !== null) return { kind: 'newer', number: newerNumber }
  const live = rows.find((row) => row.kind === 'version' && row.current && !row.newest)
  if (newest === null || newest.state === 'published' || newest.state === 'superseded') {
    if (read === 'readable') return { kind: 'this' }
    if (live) return { kind: 'older', number: live.number }
    return read === 'reading' ? { kind: 'notYetRead' } : { kind: 'never' }
  }
  if (live) return { kind: 'older', number: live.number }
  return newest.state === 'rejected' ? { kind: 'never' } : { kind: 'notYet' }
}

function nextStepOf(
  newest: DocumentVersionView | null,
  lifecycle: 'active' | 'archived',
  reviewerUserIds: readonly string[],
  viewer: DocumentLifecycleViewer | undefined,
): NextStep | null {
  if (newest === null) return null
  const me = viewer?.userId ?? null
  const may = (gesture: 'approve' | 'publish') =>
    viewer !== undefined && availableLifecycleGestures(newest, lifecycle, viewer).includes(gesture)
  switch (newest.state) {
    case 'in_review': {
      const people = [...reviewerUserIds]
      const you = (me !== null && people.includes(me)) || (people.length === 0 && may('approve'))
      return { kind: 'approve', people: people.filter((id) => id !== me), you }
    }
    case 'changes_requested': {
      const author = newest.submittedBy ?? newest.createdBy
      return { kind: 'revise', people: [author], you: author === me }
    }
    case 'draft':
      return { kind: 'submit', people: [newest.createdBy], you: newest.createdBy === me }
    case 'approved':
      return { kind: 'publish', people: [], you: may('publish') }
    default:
      return null
  }
}

export type Person = { kind: 'you' } | { kind: 'name'; name: string } | { kind: 'unknown' }

export function resolvePerson(
  userId: string | null | undefined,
  viewerUserId: string | null | undefined,
  ...sources: readonly (ReadonlyMap<string, string> | undefined)[]
): Person {
  if (!userId) return { kind: 'unknown' }
  if (viewerUserId && userId === viewerUserId) return { kind: 'you' }
  for (const source of sources) {
    const name = source?.get(userId)?.trim()
    if (name) return { kind: 'name', name }
  }
  return { kind: 'unknown' }
}
