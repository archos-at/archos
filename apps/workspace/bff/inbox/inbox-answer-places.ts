import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isAgentWakesEnabled } from '@/lib/authz/feature-flags'
import type { InboxItem } from '@/lib/db/schema/inbox'
import { canWriteDocument } from '@/lib/documents/can-write'
import { targetKey } from './inbox-target-access'
import type { InboxTargetAccess } from './targets'
import { canonicalInboxType, isMarkAnchored, type InboxAnswerPlace } from './types'

const asksAboutMark = (row: InboxItem): boolean =>
  row.actionable && row.resourceType === 'document' && row.anchorId !== null && !row.inertAt && isMarkAnchored(row.type)

export interface MarkAnswers {
  writable: ReadonlySet<string>
  wakesOn: boolean
}

export async function markAnswersFor(
  session: AuthorizedSession,
  rows: readonly InboxItem[],
  targets: Map<string, InboxTargetAccess | null>,
): Promise<MarkAnswers> {
  const documentIds = new Set(
    rows
      .filter((row) => asksAboutMark(row) && targets.get(targetKey(row.resourceType, row.resourceId)))
      .map((row) => row.resourceId),
  )
  const verdicts = await Promise.all(
    [...documentIds].map(async (documentId) => [documentId, await canWriteDocument(session, documentId).catch(() => false)] as const),
  )
  return {
    writable: new Set(verdicts.filter(([, writable]) => writable).map(([documentId]) => documentId)),
    wakesOn: isAgentWakesEnabled(session),
  }
}

export function answerPlaceOf(row: InboxItem, reachable: boolean, answers: MarkAnswers): InboxAnswerPlace | null {
  if (!reachable || !asksAboutMark(row) || !answers.writable.has(row.resourceId)) return null
  return canonicalInboxType(row.type) === 'agent.asks_you' && !answers.wakesOn ? 'review' : 'row'
}
