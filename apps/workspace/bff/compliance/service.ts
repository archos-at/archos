import 'server-only'
import { recordAuditEvent } from '@/lib/audit/service'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DeletionEntityType } from '@/lib/db/schema/deletion-queue'
import type { LegalHold } from '@/lib/db/schema/legal-holds'
import {
  insertHold,
  listOpenHoldsInOrg,
  listPendingDeletionsInOrg,
  releaseHoldInOrg,
  type DeletionQueueSummary,
} from './repository'

export interface CreateHoldInput {
  entityType: DeletionEntityType
  entityId: string
  reason: string
}

export async function listOpenHolds(session: AuthorizedSession): Promise<LegalHold[]> {
  return listOpenHoldsInOrg(session.organizationId)
}

export async function createHold(
  session: AuthorizedSession,
  input: CreateHoldInput,
  request: Request,
): Promise<LegalHold> {
  const hold = await insertHold({
    ...input,
    organizationId: session.organizationId,
    createdBy: session.userId,
  })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'compliance.hold.created',
    targetType: 'legal_hold',
    targetId: hold.id,
    metadata: { entityType: input.entityType, entityId: input.entityId },
    request,
  })

  return hold
}

export async function releaseHold(
  session: AuthorizedSession,
  holdId: string,
  request: Request,
): Promise<LegalHold> {
  const hold = await releaseHoldInOrg(holdId, session.organizationId)
  if (!hold) throw new NotFoundError()

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'compliance.hold.released',
    targetType: 'legal_hold',
    targetId: hold.id,
    metadata: { entityType: hold.entityType, entityId: hold.entityId },
    request,
  })

  return hold
}

export async function listPendingDeletions(session: AuthorizedSession): Promise<DeletionQueueSummary[]> {
  return listPendingDeletionsInOrg(session.organizationId)
}
