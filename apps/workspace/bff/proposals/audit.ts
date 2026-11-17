import 'server-only'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import { parseKindPayload, type KindPayload } from './kinds'
import type { ProposedChangeRow } from './repository'

const NO_FACTS = { operation: null, items: null, memoryScope: null }

function payloadFacts(typed: KindPayload) {
  switch (typed.kind) {
    case 'file_operation':
      return {
        operation: typed.payload.operation,
        items: typed.payload.operations.length,
        memoryScope: null,
      }
    case 'memory':
      return { operation: null, items: 1, memoryScope: typed.payload.scope }
    case 'project_profile':
      return { operation: null, items: typed.payload.patch.length, memoryScope: null }
    case 'operation':
      return { operation: typed.payload.operation, items: 1, memoryScope: null }
  }
}

function storedFacts(row: ProposedChangeRow) {
  try {
    return payloadFacts(parseKindPayload(row.kind, row.payload))
  } catch {
    return NO_FACTS
  }
}

const proposalTargets = (row: ProposedChangeRow) => [
  { type: 'project', id: row.projectId },
  { type: 'conversation', id: row.originConversationId },
]

export function auditProposalCreated(
  session: AuthorizedSession,
  row: ProposedChangeRow,
  typed: KindPayload
): void {
  const facts = payloadFacts(typed)
  recordAuditEventAfterCommit({
    action: 'piloti.proposal.created',
    organizationId: row.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'proposed_change',
    targetId: row.id,
    alsoTargets: proposalTargets(row),
    metadata: {
      kind: row.kind,
      operation: facts.operation,
      items: facts.items,
      memoryScope: facts.memoryScope,
      messageId: row.originMessageId,
    },
  })
}

export function auditProposalDecided(session: AuthorizedSession, row: ProposedChangeRow): void {
  const facts = storedFacts(row)
  const results = row.results ?? []
  recordAuditEventAfterCommit({
    action: 'piloti.proposal.decided',
    organizationId: row.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'proposed_change',
    targetId: row.id,
    alsoTargets: proposalTargets(row),
    metadata: {
      kind: row.kind,
      decision: row.status,
      operation: facts.operation,
      items: facts.items,
      appliedItems: row.status === 'dismissed' ? 0 : results.filter((result) => result.ok).length,
      memoryScope: results.find((result) => result.scope)?.scope ?? facts.memoryScope,
      onBehalfOf: row.onBehalfOf,
      messageId: row.originMessageId,
    },
  })
}
