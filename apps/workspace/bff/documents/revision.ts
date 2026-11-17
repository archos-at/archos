import 'server-only'

import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { getAccessibleDocument } from './access'
import { documentDisplayName } from './display-name'
import { forkDraftVersion } from './lifecycle'
import { findOpenVersion, listDocumentVersions } from './version-repository'

export interface RevisionDraft {
  version: DocumentVersion
  filename: string
  reviewers: string[]
}

export async function openDraftForRevision(
  session: AuthorizedSession,
  documentId: string,
): Promise<RevisionDraft> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const open = await findOpenVersion(documentId, session.organizationId)
  const version = open ?? (await forkOrJoin(session, documentId))

  return {
    version,
    filename: documentDisplayName(document),
    reviewers: await lastRefusers(documentId, session.organizationId),
  }
}

async function forkOrJoin(session: AuthorizedSession, documentId: string): Promise<DocumentVersion> {
  try {
    return await forkDraftVersion(session, documentId)
  } catch (error) {
    if (!(error instanceof ConflictError) || !hasVersionId(error.details)) throw error
    const winner = await findOpenVersion(documentId, session.organizationId)
    if (!winner) throw error
    return winner
  }
}

function hasVersionId(details: unknown): boolean {
  return typeof details === 'object' && details !== null && 'versionId' in details
}

async function lastRefusers(documentId: string, organizationId: string): Promise<string[]> {
  const versions = await listDocumentVersions(documentId, organizationId)
  for (const version of [...versions].reverse()) {
    if ((version.state === 'changes_requested' || version.state === 'rejected') && version.reviewedBy) {
      return [version.reviewedBy]
    }
  }
  return []
}
