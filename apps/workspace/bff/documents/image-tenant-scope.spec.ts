/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asDb, makeDocument } from '@/test-utils/db-fixtures'

let observedScope: unknown

const IMAGE_DOCUMENT = makeDocument({
  id: 'doc-1',
  organizationId: 'org-from-signature',
  storageKey: 'org/proj/doc-1/plan.png',
  contentType: 'image/png',
  filename: 'plan.png',
})

vi.mock('@/lib/db', () => ({
  getDb: () => {
    const chain: Record<string | symbol, unknown> = {}
    const proxy: unknown = new Proxy(chain, {
      get(_target, property) {
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => {
            observedScope = getTenantContext()
            return Promise.resolve([IMAGE_DOCUMENT]).then(resolve)
          }
        }
        return () => proxy
      },
    })
    return asDb(proxy as Record<string, unknown>)
  },
}))

vi.mock('@/lib/db/schema/bim', () => ({
  bimModels: { id: 'id', documentId: 'document_id', organizationId: 'organization_id' },
  bimElements: { id: 'id', modelId: 'model_id' },
}))
vi.mock('@/lib/db/schema/documents', () => ({
  documents: { id: 'id', organizationId: 'organization_id' },
}))

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/assignments/service', () => ({ listAssignmentsWithoutAccessCheck: vi.fn() }))
vi.mock('@/lib/assignments/repository', () => ({ deleteAssignmentsForResource: vi.fn() }))
vi.mock('@/lib/annotations/repository', () => ({ tallyLiveMarks: vi.fn(async () => new Map()) }))
vi.mock('@/lib/collaboration/cleanup', () => ({ purgeResourceCollaboration: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('./lifecycle', () => ({
  nextVersionNumber: vi.fn().mockResolvedValue(2),
  recordUploadedVersion: vi.fn().mockResolvedValue(null),
}))
vi.mock('./version-repository', () => ({
  listDocumentVersionObjects: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))
vi.mock('@/lib/documents/vlm-capability', () => ({ isVlmConfigured: vi.fn() }))
vi.mock('./reconcile-status', () => ({ reconcileDocumentStatuses: vi.fn() }))
vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn() }))
vi.mock('@/lib/project-profile/prompt-view', () => ({ invalidateProjectPromptViewCache: vi.fn() }))

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn().mockResolvedValue({ ContentLength: 48211, Body: { transformToWebStream: () => new ReadableStream() } }) },
  signingS3Client: { send: vi.fn() },
  bucketAdminS3Client: { send: vi.fn() },
  bucketName: 'test-bucket',
}))

vi.mock('@/lib/images/signed-image-url', () => ({
  verifyDocumentImageUrl: () => ({
    ok: true,
    claims: { organizationId: 'org-from-signature', userId: 'user-from-signature', documentId: 'doc-1', variant: 'original', exp: 0 },
  }),
  buildDocumentImageUrl: () => null,
  DOCUMENT_IMAGE_CACHE_CONTROL: 'private, max-age=300',
}))

import { getTenantContext, runWithTenantSlot } from '@/lib/db/tenant-context'
import { streamDocumentImage } from './document-delivery'

describe('the signed image route runs in a scope without a session', () => {
  beforeEach(() => {
    observedScope = 'not-observed'
  })

  it('queries inside the organization the signature claims, and leaves no scope behind', async () => {
    const { response, scopeAfterStream } = await runWithTenantSlot(async () => {
      const response = await streamDocumentImage(
        'doc-1',
        new URLSearchParams({ org: 'org-from-signature', v: 'original' }),
      )
      return { response, scopeAfterStream: getTenantContext() }
    })

    expect(response.status).toBe(200)
    expect(observedScope).toEqual({
      kind: 'tenant',
      organizationId: 'org-from-signature',
      userId: null,
    })
    expect(scopeAfterStream).toBeUndefined()
  })
})
