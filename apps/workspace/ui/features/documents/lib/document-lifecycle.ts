import {
  DOCUMENT_VERSION_TRANSITIONS,
  transitionsForOp,
  type DocumentLifecyclePermission,
  type DocumentVersionOp,
  type DocumentVersionState,
  type DocumentVersionTransition,
  type DocumentVersionView,
} from '@/lib/documents/lifecycle-types'
import type { DocumentAuthor } from '@/lib/db/schema/documents'

export const DOCUMENT_REVIEW_OPS = [
  'submit',
  'approve',
  'request_changes',
  'reject',
  'publish',
] as const satisfies readonly DocumentVersionOp[]

export type DocumentReviewOp = (typeof DOCUMENT_REVIEW_OPS)[number]

export type DocumentLifecycleAction = DocumentReviewOp | 'archive'

export const DOCUMENT_ARCHIVE_PERMISSIONS: readonly DocumentLifecyclePermission[] = [
  'project:documents:write',
  'project:edit',
]

export interface DocumentLifecycleViewer {
  permissions: readonly DocumentLifecyclePermission[]
  userId?: string | null
}

function holdsAny(
  viewer: DocumentLifecycleViewer,
  accepted: readonly DocumentLifecyclePermission[],
): boolean {
  return accepted.some((permission) => viewer.permissions.includes(permission))
}

export function availableReviewOps(
  version: Pick<DocumentVersionView, 'state' | 'submittedBy'>,
  viewer: DocumentLifecycleViewer,
): DocumentReviewOp[] {
  const rows: readonly DocumentVersionTransition[] = DOCUMENT_VERSION_TRANSITIONS
  const ops = rows.filter((row) => {
    if (!(DOCUMENT_REVIEW_OPS as readonly string[]).includes(row.op)) return false
    if (row.from !== version.state) return false
    if (!holdsAny(viewer, row.permission)) return false
    if (row.alsoRequires && !viewer.permissions.includes(row.alsoRequires)) return false
    if (row.requires.notSubmitter && version.submittedBy && version.submittedBy === viewer.userId) {
      return false
    }
    return true
  }).map((row) => row.op as DocumentReviewOp)

  return [...new Set(ops)]
}

export function reviewOpRequiresComment(op: DocumentReviewOp): boolean {
  const rows = transitionsForOp(op)
  return rows.length > 0 && rows.every((row) => row.requires.comment === true)
}

export function canArchiveDocument(
  lifecycle: 'active' | 'archived',
  viewer: DocumentLifecycleViewer,
): boolean {
  return lifecycle === 'active' && holdsAny(viewer, DOCUMENT_ARCHIVE_PERMISSIONS)
}

export function availableLifecycleActions(
  version: Pick<DocumentVersionView, 'state' | 'submittedBy'> | null,
  lifecycle: 'active' | 'archived',
  viewer: DocumentLifecycleViewer,
): DocumentLifecycleAction[] {
  const review = version ? availableReviewOps(version, viewer) : []
  return canArchiveDocument(lifecycle, viewer) ? [...review, 'archive'] : review
}

export const DELEGATE_REVISION = 'delegate_revision'

export type DocumentLifecycleGesture = DocumentLifecycleAction | typeof DELEGATE_REVISION

export interface DocumentLifecycleRequest {
  action: DocumentLifecycleAction
  delegateRevision: boolean
}

export function lifecycleRequestFor(gesture: DocumentLifecycleGesture): DocumentLifecycleRequest {
  return gesture === DELEGATE_REVISION
    ? { action: 'request_changes', delegateRevision: true }
    : { action: gesture, delegateRevision: false }
}

export function availableLifecycleGestures(
  version: Pick<DocumentVersionView, 'state' | 'submittedBy'> | null,
  lifecycle: 'active' | 'archived',
  viewer: DocumentLifecycleViewer,
): DocumentLifecycleGesture[] {
  return availableLifecycleActions(version, lifecycle, viewer).flatMap((action) =>
    action === 'request_changes' ? [action, DELEGATE_REVISION] : [action],
  )
}

export type DocumentBadgeState = DocumentVersionState | 'archived'

export interface DocumentVersionBadgeSubject {
  versionState?: DocumentVersionState | null
  versionCount?: number | null
  lifecycle?: 'active' | 'archived'
  authoredBy?: DocumentAuthor | null
}

export function showsVersionStateBadge(subject: DocumentVersionBadgeSubject): boolean {
  if (subject.lifecycle === 'archived') return true
  if (!subject.versionState) return false
  return (subject.versionCount ?? 0) > 1 || subject.authoredBy === 'agent'
}

export function documentBadgeState(
  subject: DocumentVersionBadgeSubject,
): DocumentBadgeState | null {
  if (!showsVersionStateBadge(subject)) return null
  if (subject.lifecycle === 'archived') return 'archived'
  return subject.versionState ?? null
}

export const LIFECYCLE_STAGES = ['draft', 'in_review', 'approved', 'published'] as const

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]

export type LifecycleTone = 'moving' | 'settled' | 'stopped' | 'retired'

export interface LifecycleProgress {
  reached: number
  halted: boolean
  archived: boolean
  tone: LifecycleTone
}

const STAGE_PROGRESS: Record<
  DocumentVersionState,
  { reached: number; halted: boolean; tone: LifecycleTone }
> = {
  draft: { reached: 1, halted: false, tone: 'moving' },
  in_review: { reached: 2, halted: false, tone: 'moving' },
  changes_requested: { reached: 1, halted: true, tone: 'stopped' },
  approved: { reached: 3, halted: false, tone: 'settled' },
  published: { reached: 4, halted: false, tone: 'settled' },
  rejected: { reached: 2, halted: true, tone: 'stopped' },
  superseded: { reached: 4, halted: false, tone: 'settled' },
}

export function lifecycleProgress(
  version: Pick<DocumentVersionView, 'state'> | null,
  lifecycle: 'active' | 'archived',
): LifecycleProgress {
  const archived = lifecycle === 'archived'
  if (!version) return { reached: 0, halted: false, archived, tone: 'moving' }
  const stage = STAGE_PROGRESS[version.state]
  return { ...stage, archived, tone: archived ? 'retired' : stage.tone }
}

export function lifecycleMeaning(
  version: Pick<DocumentVersionView, 'state'> | null,
  lifecycle: 'active' | 'archived',
  { live }: { live: boolean },
): string {
  if (lifecycle === 'archived') return 'archived'
  if (!version) return 'none'
  const suffix = live ? 'Live' : 'Alone'
  switch (version.state) {
    case 'draft':
      return `draft${suffix}`
    case 'in_review':
      return `inReview${suffix}`
    case 'changes_requested':
      return `changesRequested${suffix}`
    case 'approved':
      return `approved${suffix}`
    case 'rejected':
      return `rejected${suffix}`
    case 'published':
      return 'published'
    case 'superseded':
      return 'superseded'
  }
}

export function lifecycleNeedsReader(
  version: Pick<DocumentVersionView, 'state' | 'submittedBy'> | null,
  lifecycle: 'active' | 'archived',
  viewer: DocumentLifecycleViewer,
): boolean {
  return availableLifecycleGestures(version, lifecycle, viewer).some(
    (gesture) => gesture !== 'archive',
  )
}
