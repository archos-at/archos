import 'server-only'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { purgeConversationCollaboration } from '@/lib/collaboration/cleanup'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { requireResourceAccess } from '@/lib/sharing/access'
import { withTenant } from '@/lib/db/tenant-context'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import {
  BFF_JOB_PRIORITY,
  emptyCounts,
  recordJobFailure,
  requesterOf,
  type EraseConversationsPayload,
  type JobSliceResult,
} from '@/lib/jobs-queue/types'
import { discardConversationDrafts } from './working-directory'
import {
  deleteConversationInOrg,
  findConversationTenancy,
  markConversationDeleting,
  recordConversationErased,
} from './repository'
import {
  listMarkedOwnConversationIds,
  markOwnConversationsDeleting,
  type ConversationSide,
} from './own-conversations-repository'

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

export interface OwnConversationsDeleted {
  deleted: string[]
  held: { id: string; title: string | null }[]
}

export async function deleteOwnConversations(
  session: AuthorizedSession,
  side: ConversationSide
): Promise<OwnConversationsDeleted> {
  if (side.projectId) await requireProjectAccess(session, side.projectId, 'project:view')

  const { markedAt, marked, held } = await markOwnConversationsDeleting(
    session.organizationId,
    session.userId,
    side
  )
  if (marked.length > 0) {
    const payload: EraseConversationsPayload = {
      markedAt: markedAt.toISOString(),
      requester: requesterOf(session),
      cursor: null,
      counts: emptyCounts(),
    }
    try {
      await enqueueJob({
        kind: 'erase_conversations',
        organizationId: session.organizationId,
        payload: { ...payload },
        priority: BFF_JOB_PRIORITY.interactive,
      })
    } catch (error) {
      console.error(
        `[conversations] the erase job for ${marked.length} chat(s) was not stored; their deletion queue rows erase them:`,
        error
      )
    }
  }
  return { deleted: marked.map((row) => row.id), held }
}

export const ERASE_SLICE_CONVERSATIONS = 10

export async function runEraseConversationsSlice(
  session: AuthorizedSession,
  payload: EraseConversationsPayload
): Promise<JobSliceResult<EraseConversationsPayload>> {
  const { organizationId, userId } = session
  const ids = await withTenant({ organizationId, userId }, () =>
    listMarkedOwnConversationIds(organizationId, userId, new Date(payload.markedAt), {
      after: payload.cursor,
      limit: ERASE_SLICE_CONVERSATIONS,
    })
  )
  const counts = { ...payload.counts, failedNames: [...payload.counts.failedNames] }
  for (const conversationId of ids) {
    try {
      await withTenant({ organizationId, userId }, async () => {
        await assertNoActiveHold(organizationId, 'conversation', conversationId)
        await eraseMarkedConversation(organizationId, conversationId)
      })
      counts.queued += 1
    } catch (error) {
      console.warn(
        `[conversations] erasing ${conversationId} failed; the purger retries it from the deletion queue:`,
        error
      )
      recordJobFailure(counts, conversationId)
    }
  }
  const cursor = ids.at(-1) ?? payload.cursor
  return {
    done: ids.length < ERASE_SLICE_CONVERSATIONS,
    payload: { ...payload, cursor, counts },
  }
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
