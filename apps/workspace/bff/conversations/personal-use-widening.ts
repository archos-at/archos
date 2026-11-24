import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DbExecutor } from '@/lib/db/executor'
import { SHARING_ERROR_REASONS } from '@/lib/sharing/types'
import { listPersonalSources } from './personal-use'
import type { AudienceWidening } from './restricted-use'
import { readConversationAudience } from './restricted-use-repository'

export async function assertPersonalUseConfirmed(
  session: AuthorizedSession,
  executor: DbExecutor,
  conversationId: string,
  widening: AudienceWidening,
): Promise<void> {
  const sources = await listPersonalSources(executor, session.organizationId, conversationId)
  if (sources.length === 0) return
  const audience = await readConversationAudience(executor, session.organizationId, conversationId)
  const asksOwner = audience.createdBy === session.userId && !(widening.kind === 'person' && widening.self)
  if (!asksOwner) {
    throw new ConflictError('This conversation drew on its owner’s own files or notes; only its owner may share it.', {
      reason: SHARING_ERROR_REASONS.personalContentOwner,
    })
  }
  if (widening.confirmedPersonal === true) return
  throw new ConflictError(
    'This conversation drew on your own files or notes. The people you share it with will see the answers, not the files. Confirm to share it.',
    { reason: SHARING_ERROR_REASONS.personalContentConfirm, sources },
  )
}
