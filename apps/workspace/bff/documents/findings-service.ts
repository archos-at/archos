import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  deriveDocumentFindings,
  referencedBy,
  resolveReferences,
  toFindingsDocument,
  type FindingsDocument,
} from './findings'
import type { DocumentFindingsResponse } from './findings-wire'
import { documentLevelQuery, DOCUMENT_LEVEL_LIMIT_MAX } from './list-query'
import type { ProfileFacts } from './profile-contradictions'
import { listDocumentsPage } from './document-listing'
import { findProjectProfileInOrg } from '@/lib/projects/repository'

const MAX_PAGES = 4

async function readShelf(
  session: AuthorizedSession,
  projectId: string
): Promise<{ documents: FindingsDocument[]; truncated: boolean }> {
  const documents: FindingsDocument[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const level = documentLevelQuery({ limit: DOCUMENT_LEVEL_LIMIT_MAX, ...(cursor ? { cursor } : {}) })
    const read = await listDocumentsPage(session, projectId, { includeArchived: false, level })
    documents.push(...read.documents.map(toFindingsDocument))
    if (!read.nextCursor) return { documents, truncated: false }
    cursor = read.nextCursor
  }
  return { documents, truncated: true }
}

async function readProfile(organizationId: string, projectId: string): Promise<ProfileFacts | null> {
  try {
    return (await findProjectProfileInOrg(projectId, organizationId))?.profile ?? null
  } catch (error) {
    console.warn(`[findings] the profile of project ${projectId} could not be read; compared without it:`, error)
    return null
  }
}

export interface ProjectFindingsInput {
  documents: FindingsDocument[]
  truncated: boolean
  profile: ProfileFacts | null
}

export async function readProjectFindingsInput(session: AuthorizedSession, projectId: string): Promise<ProjectFindingsInput> {
  const { documents, truncated } = await readShelf(session, projectId)
  return { documents, truncated, profile: await readProfile(session.organizationId, projectId) }
}

export async function getProjectDocumentFindings(
  session: AuthorizedSession,
  projectId: string,
  documentId?: string
): Promise<DocumentFindingsResponse> {
  const { documents, truncated, profile } = await readProjectFindingsInput(session, projectId)
  const subject = documentId ? documents.find((document) => document.id === documentId) : undefined
  return {
    findings: deriveDocumentFindings(documents, profile),
    documentCount: documents.length,
    truncated,
    document: subject
      ? { references: resolveReferences(subject, documents), referencedBy: referencedBy(subject, documents) }
      : null,
  }
}
