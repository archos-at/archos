import 'server-only'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { requireProjectAccess } from '@/lib/authz/projects'
import { findConversationInOrg, insertConversation } from '@/lib/conversations/repository'
import type { Document } from '@/lib/db/schema/documents'
import { documentThreadConversationId } from './wake-ids'

const MAX_TITLE = 200

export async function ensureDocumentThread(
  session: AuthorizedSession,
  doc: Pick<Document, 'id' | 'projectId' | 'filename' | 'displayName'>,
  title?: string | null
): Promise<string> {
  if (doc.projectId) await requireProjectAccess(session, doc.projectId, CHAT_PERMISSIONS)
  const id = documentThreadConversationId(doc.id, session.userId)
  const inserted = await insertConversation({
    id,
    organizationId: session.organizationId,
    createdBy: session.userId,
    title: (title?.trim() || doc.displayName?.trim() || doc.filename).slice(0, MAX_TITLE),
    projectId: doc.projectId ?? null,
    subjectResourceType: 'document',
    subjectResourceId: doc.id,
  })
  if (inserted) return id
  const existing = await findConversationInOrg(id, session.organizationId)
  if (!existing || existing.createdBy !== session.userId) throw new NotFoundError()
  if (existing.deletedAt) throw new ConflictError('This thread is being deleted. Try again in a few minutes.')
  return id
}
