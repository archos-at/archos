import { makeDocument } from '@/test-utils/db-fixtures'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import type { AuthorizedSession } from '@/lib/auth/types'

export const session: AuthorizedSession = {
  userId: 'user_reviewer',
  email: 'reviewer@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'admin',
  permissions: [],
  featureFlags: null,
}

export const document: Document = makeDocument({ id: 'doc_1', projectId: 'proj_1' })

export const agentDocument: Document = makeDocument({
  id: 'doc_1',
  projectId: 'proj_1',
  authoredBy: 'agent',
  authoredByProducer: 'agent_document',
  authoredByRef: 'conv_1-aktenvermerk',
  authoredByRefKind: 'answer_artifact',
  filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md',
  contentType: 'text/markdown',
})

export function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: 'ver_1',
    organizationId: 'org_1',
    documentId: 'doc_1',
    projectId: 'proj_1',
    versionNumber: 1,
    state: 'draft',
    origin: 'draft',
    storageKey: 'org/org_1/project/proj_1/doc/doc_1/plan.md',
    storageBucket: 'grid-org-1',
    contentType: 'text/markdown',
    fileSize: 12,
    contentHash: 'sha256:abc',
    screenedHash: null,
    submittedBy: null,
    submittedByActor: 'human',
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    reviewComment: null,
    createdBy: 'user_author',
    originConversationId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}
