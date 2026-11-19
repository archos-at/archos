import 'server-only'
import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import { parseUploadReport } from '@/lib/upload-batches/upload-report'
import { answerPlaceOf, type MarkAnswers } from './inbox-answer-places'
import { coerceCount, coerceDay, coerceMentions, coerceText, coerceVariant, nonEmpty } from './inbox-payload-coercion'
import { targetKey } from './inbox-target-access'
import type { InboxTargetAccess, RunMessageRef } from './targets'
import { canonicalInboxType, type InboxItemState, type InboxItemView } from './types'

const SUBJECT_MAX_LENGTH = 200
const EXCERPT_MAX_LENGTH = 500

function deriveState(row: InboxItem): InboxItemState {
  if (row.inertAt) return 'inert'
  if (row.archivedAt) return 'archived'
  if (row.resolvedAt) return 'resolved'
  if (row.readAt) return 'read'
  return 'unread'
}

export function toItemView(
  row: InboxItem,
  targets: Map<string, InboxTargetAccess | null>,
  actorNames: Map<string, string>,
  withheld: ReadonlySet<string>,
  answers: MarkAnswers,
  projectNames: ReadonlyMap<string, string>,
): InboxItemView {
  const access =
    row.inertAt || withheld.has(row.id) ? null : (targets.get(targetKey(row.resourceType, row.resourceId)) ?? null)
  const payload: Record<string, unknown> = row.payload ?? {}
  const taskId = nonEmpty(payload.taskId)
  const conversationId = nonEmpty(payload.conversationId)
  const runId = nonEmpty(payload.runId)
  const messageId = nonEmpty(payload.runMessageId)
  const folderId = nonEmpty(payload.folderId)
  const entryId = nonEmpty(payload.entryId)
  const run: RunMessageRef | null =
    conversationId && runId && messageId ? { conversationId, runId, messageId } : null
  const answerIn = answerPlaceOf(row, access !== null, answers)

  return {
    id: row.id,
    type: canonicalInboxType(row.type) as InboxItemType,
    state: deriveState(row),
    archived: row.archivedAt !== null,
    read: row.readAt !== null,
    actionable: row.actionable,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    projectId: access?.projectId ?? null,
    projectName: access?.projectId ? (projectNames.get(access.projectId) ?? null) : null,
    anchorId: row.anchorId,
    actorName: row.actorUserId
      ? (actorNames.get(row.actorUserId) ?? (access ? coerceText(payload.actorName, SUBJECT_MAX_LENGTH) : null))
      : null,
    actorUserId: row.actorUserId,
    count: row.count,
    href: access
      ? access.deepLink({ itemType: canonicalInboxType(row.type), anchorId: row.anchorId, taskId, run, folderId, entryId })
      : null,
    subject: access ? coerceText(payload.subject, SUBJECT_MAX_LENGTH) : null,
    related: access ? coerceText(payload.related, SUBJECT_MAX_LENGTH) : null,
    excerpt: access ? coerceText(payload.excerpt, EXCERPT_MAX_LENGTH) : null,
    mentions: access ? coerceMentions(payload.mentions) : [],
    variant: access ? coerceVariant(payload.variant) : null,
    dueOn: access ? coerceDay(payload.dueOn) : null,
    via: access ? coerceText(payload.via, SUBJECT_MAX_LENGTH) : null,
    openMarks: access ? coerceCount(payload.openMarks) : null,
    marksRevision: access ? coerceCount(payload.marksRevision ?? payload.marksFassung) : null,
    uploadReport: access ? parseUploadReport(payload.report) : null,
    answerIn,
    pilotiWakes: answerIn === 'row' && answers.wakesOn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
