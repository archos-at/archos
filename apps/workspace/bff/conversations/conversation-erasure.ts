import 'server-only'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { purgeConversationCollaboration } from '@/lib/collaboration/cleanup'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { requireResourceAccess } from '@/lib/sharing/access'
import { discardConversationDrafts } from './working-directory'
import {
  deleteConversationInOrg,
  findConversationTenancy,
  markConversationDeleting,
  recordConversationErased,
} from './repository'

async function authorizeConversationDelete(
  session: AuthorizedSession,
  conversationId: string
): Promise<void> {
  try {
    await requireResourceAccess(session, 'conversation', conversationId, 'owner', { allowLocked: true })
    return
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error

    const tenancy = await findConversationTenancy(conversationId)
    if (
      !tenancy?.deletedAt ||
      tenancy.organizationId !== session.organizationId ||
      tenancy.createdBy !== session.userId
    ) {
      throw error
    }
    if (tenancy.projectId) {
      await requireProjectAccess(session, tenancy.projectId, 'project:view')
    }
  }
}

export async function assertConversationAcceptsUploads(
  conversationId: string,
  organizationId: string
): Promise<void> {
  const tenancy = await findConversationTenancy(conversationId)
  if (!tenancy || tenancy.organizationId !== organizationId) throw new NotFoundError()
  if (tenancy.deletedAt) {
    throw new ConflictError('This chat is being deleted; no further files can be attached to it.')
  }
}

export async function deleteConversation(
  session: AuthorizedSession,
  conversationId: string
): Promise<void> {
  await authorizeConversationDelete(session, conversationId)

  await assertNoActiveHold(session.organizationId, 'conversation', conversationId)

  const marked = await markConversationDeleting(conversationId, session.organizationId, session.userId)
  if (!marked) throw new NotFoundError()

  await eraseMarkedConversation(session.organizationId, conversationId)
}

export async function retryConversationErasure(
  organizationId: string,
  conversationId: string
): Promise<{ outcome: 'erased' | 'already-gone' }> {
  await assertNoActiveHold(organizationId, 'conversation', conversationId)
  const tenancy = await findConversationTenancy(conversationId)
  if (tenancy && tenancy.organizationId !== organizationId) throw new NotFoundError()
  if (tenancy && !tenancy.deletedAt) {
    throw new ConflictError('This chat is not being deleted.', { reason: 'not_deleting' })
  }
  await eraseMarkedConversation(organizationId, conversationId)
  return { outcome: tenancy ? 'erased' : 'already-gone' }
}

async function eraseMarkedConversation(organizationId: string, conversationId: string): Promise<void> {
  const purge = await purgeSessionDocuments(conversationId, organizationId)
  if (!purge.ok) {
    console.error(
      `[conversations] session document cleanup incomplete for ${conversationId} — ` +
        `${purge.retained} row(s) retained for retry:`,
      purge.failures.join('; ')
    )
    throw new UpstreamError(
      'Deleting the chat’s attachments failed; the chat was kept so it can be retried.'
    )
  }

  const collection = await deleteSessionCollection(sessionCollectionName(conversationId))
  if (!collection.ok) {
    console.error(
      `[conversations] session collection erase incomplete for ${conversationId}:`,
      collection.reason
    )
    throw new UpstreamError(
      'Deleting the chat’s attachments failed; the chat was kept so it can be retried.'
    )
  }

  await deleteConversationInOrg(conversationId, organizationId)

  await purgeConversationCollaboration(conversationId)

  await recordConversationErased(conversationId, organizationId)

  await discardConversationDrafts(conversationId)
}
