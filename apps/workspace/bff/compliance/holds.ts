import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { DeletionEntityType } from '@/lib/db/schema/deletion-queue'
import { LEGAL_HOLD_MESSAGE, LEGAL_HOLD_REASON } from './legal-hold-codes'
import { isCoveredByActiveHold } from './repository'

export async function assertNoActiveHold(
  organizationId: string,
  entityType: DeletionEntityType,
  entityId: string,
): Promise<void> {
  if (!(await isCoveredByActiveHold(organizationId, entityType, entityId))) return
  throw new ConflictError(LEGAL_HOLD_MESSAGE, { reason: LEGAL_HOLD_REASON, entityType })
}
