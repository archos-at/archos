import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { FIXTURE } from './fixtures'

export const REVIEW_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-review',
  versionState: 'in_review',
  versionCount: 2,
}

export const REVIEW_PERMISSIONS = [
  'project:view',
  'project:edit',
  'project:documents:write',
] as const

export const REVIEW_VERSIONS = {
  documentId: 'dev-doc-review',
  lifecycle: 'active',
  publishedVersionId: null,
  versions: [
    {
      id: 'ver_1',
      documentId: 'dev-doc-review',
      versionNumber: 1,
      state: 'in_review',
      contentType: 'text/markdown',
      fileSize: 18_400,
      contentHash: 'sha256:1',
      submittedBy: 'u-2',
      submittedAt: '2026-09-03T10:15:00.000Z',
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      reviewComment: null,
      createdBy: 'u-2',
      createdAt: '2026-09-02T07:30:00.000Z',
      updatedAt: '2026-09-03T10:15:00.000Z',
    },
  ],
}
