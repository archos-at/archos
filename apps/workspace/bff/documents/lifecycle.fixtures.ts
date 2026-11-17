import { vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { makeDocument } from '@/test-utils/db-fixtures'
import { promoteVersionToPublished } from './version-repository'

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

export function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: 'ver_1',
    organizationId: 'org_1',
    documentId: 'doc_1',
    projectId: 'proj_1',
    versionNumber: 2,
    state: 'in_review',
    origin: 'draft',
    storageKey: 'org/org_1/project/proj_1/doc/doc_1/v2/plan.md',
    storageBucket: 'grid-org-1',
    contentType: 'text/markdown',
    fileSize: 12,
    contentHash: 'sha256:abc',
    screenedHash: null,
    submittedBy: 'user_author',
    submittedAt: new Date('2026-09-01T00:00:00Z'),
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    reviewComment: null,
    createdBy: 'user_author',
    originConversationId: null,
    submittedByActor: 'human',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

export function approvedInOneStep(): void {
  vi.mocked(promoteVersionToPublished).mockResolvedValue({
    version: version({ state: 'published' }),
    superseded: [],
  })
}
