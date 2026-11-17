import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isFolderVisibleTo, requireFolderWrite } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { requireResourceAccess } from '@/lib/sharing/access'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import type { Document } from '@/lib/db/schema/documents'
import { mayReviewQuarantine } from '@/lib/upload-screening/quarantine-reviewers'
import { internalRead, memberReader } from './document-reader'
import { findDocumentInOrg } from './repository'

export async function findDocumentForSession(
  session: AuthorizedSession,
  documentId: string,
): Promise<Document | null> {
  const visible = await findDocumentInOrg(documentId, session.organizationId, memberReader(session.userId))
  if (visible) return visible
  const held = await findDocumentInOrg(documentId, session.organizationId, internalRead('quarantine-review'))
  return held && (await mayReviewQuarantine(session, held)) ? held : null
}

export type DocumentAccessIntent = 'read' | 'write'

export async function getAccessibleDocument(
  session: AuthorizedSession,
  documentId: string,
  intent: DocumentAccessIntent = 'read',
): Promise<Document> {
  const doc = await findDocumentForSession(session, documentId)
  if (!doc) throw new NotFoundError()

  switch (doc.scope) {
    case 'office_shelf': {
      if (intent === 'write' && !canManageOfficeShelf(session)) throw new ForbiddenError()
      return doc
    }
    case 'session': {
      if (!doc.conversationId) throw new NotFoundError()
      await requireResourceAccess(
        session,
        'conversation',
        doc.conversationId,
        intent === 'write' ? 'collaborator' : 'viewer',
      )
      return doc
    }
    case 'project': {
      if (doc.projectId === null) throw new NotFoundError()
      await requireProjectAccess(
        session,
        doc.projectId,
        intent === 'write' ? ['project:documents:write', 'project:edit'] : 'project:view',
      )
      if (!(await isFolderVisibleTo(session, doc.projectId, doc.folderId))) throw new NotFoundError()
      if (intent === 'write') await requireFolderWrite(session, doc.projectId, [doc.folderId])
      return doc
    }
    default: {
      const unhandledScope: never = doc.scope
      void unhandledScope
      throw new NotFoundError()
    }
  }
}
