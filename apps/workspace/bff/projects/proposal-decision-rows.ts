import 'server-only'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { conversations } from '@/lib/db/schema/conversations'
import { proposedChanges } from '@/lib/db/schema/proposed-changes'
import { conversationOpenToProjectReaders } from '@/lib/conversations/repository'

export const DECIDED_PROPOSAL_STATUSES = ['applied', 'partially_applied', 'dismissed'] as const
export type DecidedProposalStatus = (typeof DECIDED_PROPOSAL_STATUSES)[number]

export interface DecidedProposalRow {
  id: string
  kind: string
  status: DecidedProposalStatus
  payload: unknown
  decidedAt: Date
}

const isDecidedStatus = (status: string): status is DecidedProposalStatus =>
  (DECIDED_PROPOSAL_STATUSES as readonly string[]).includes(status)

export async function listRecentDecidedProposals(
  projectId: string,
  organizationId: string,
  limit: number,
  db: DbExecutor = getDb(),
): Promise<DecidedProposalRow[]> {
  const rows = await db
    .select({
      id: proposedChanges.id,
      kind: proposedChanges.kind,
      status: proposedChanges.status,
      payload: proposedChanges.payload,
      decidedAt: proposedChanges.decidedAt,
    })
    .from(proposedChanges)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, proposedChanges.originConversationId),
        eq(conversations.organizationId, proposedChanges.organizationId),
      ),
    )
    .where(
      and(
        eq(proposedChanges.organizationId, organizationId),
        eq(proposedChanges.projectId, projectId),
        inArray(proposedChanges.status, [...DECIDED_PROPOSAL_STATUSES]),
        isNull(conversations.deletedAt),
        conversationOpenToProjectReaders(),
      ),
    )
    .orderBy(desc(proposedChanges.decidedAt), desc(proposedChanges.id))
    .limit(limit)
  return rows.flatMap((row) =>
    isDecidedStatus(row.status) && row.decidedAt
      ? [
          {
            id: String(row.id),
            kind: String(row.kind),
            status: row.status,
            payload: row.payload,
            decidedAt: new Date(row.decidedAt),
          },
        ]
      : [],
  )
}
