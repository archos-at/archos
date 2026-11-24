/**
 * @vitest-environment node
 *
 * `document-upload` (ADR-0122): the multipart form the dispatcher builds from an
 * agent's base64 body is accepted by this route's own parser, field for field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callOperation } from '@/lib/agent-api/dispatch'
import { findOperation } from '@/lib/agent-api/catalog'

vi.mock('@/lib/documents/document-dispatch', () => ({
  uploadDocument: vi.fn(),
}))
vi.mock('@/lib/conversations/restricted-egress', () => ({ requireMayFileFrom: vi.fn(async () => undefined) }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/documents/shelf-authz', async (original) => ({
  ...(await original<typeof import('@/lib/documents/shelf-authz')>()),
  requireShelfWrite: vi.fn(async () => undefined),
}))
vi.mock('@/lib/documents/shelf-collection', () => ({ shelfCollectionName: vi.fn(async () => 'proj_proj-1') }))

import { uploadDocument } from '@/lib/documents/document-dispatch'
import { ConversationConfinedError } from '@/lib/api/errors'
import { requireMayFileFrom } from '@/lib/conversations/restricted-egress'
import { requireResourceAccess } from '@/lib/sharing/access'
import { requireShelfWrite } from '@/lib/documents/shelf-authz'
import { ForbiddenError } from '@/lib/api/errors'

const session = {
  userId: 'user-1',
  email: 'test@grid.com',
  name: null,
  accessToken: '',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'admin' as const,
  permissions: [],
  featureFlags: null,
}
const BATCH = '2f6c3b1e-0d3a-4d2e-9a53-6d1f9d6c2b11'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(uploadDocument).mockResolvedValue({ documentId: 'd1', jobId: null, status: 'uploaded', filename: 'Plan.pdf' })
})

describe('document-upload', () => {
  it('hands the route its file and every field it reads', async () => {
    const op = findOperation('document-upload')
    if (!op) throw new Error('document-upload is not in the catalog')
    const result = await callOperation(
      op,
      {
        body: {
          files: [{ name: 'Plan.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF fake').toString('base64') }],
          fields: { projectId: 'proj-1', folderId: 'fold-1', originPath: 'EG/Plan.pdf', screeningRelease: 'name', uploadBatchId: BATCH },
        },
      },
      session,
    )

    expect(result.status).toBe(200)
    expect(uploadDocument).toHaveBeenCalledTimes(1)
    const input = vi.mocked(uploadDocument).mock.calls[0]?.[1]
    expect(input).toMatchObject({
      projectId: 'proj-1',
      folderId: 'fold-1',
      originPath: 'EG/Plan.pdf',
      screeningRelease: true,
      uploadBatchId: BATCH,
      revisionOf: null,
      originConversationId: null,
    })
    expect(input?.file.name).toBe('Plan.pdf')
    expect(await input?.file.text()).toBe('%PDF fake')
  })

  it('files from a conversation only where the filing guard lets it, before anything is stored (ADR-0193)', async () => {
    const op = findOperation('document-upload')
    if (!op) throw new Error('document-upload is not in the catalog')
    const body = (fields: Record<string, string>) => ({
      body: { files: [{ name: 'Plan.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }], fields },
    })

    await callOperation(op, body({ projectId: 'proj-1', folderId: 'fold-1', originConversationId: 's_conv_1' }), session)
    expect(requireResourceAccess).toHaveBeenCalledWith(session, 'conversation', 's_conv_1', 'viewer')
    expect(requireMayFileFrom).toHaveBeenCalledWith(
      { conversationId: 's_conv_1', locale: expect.any(String) },
      { organizationId: 'org-1', projectId: 'proj-1', projectCollection: 'proj_proj-1', folderId: 'fold-1' },
    )
    expect(uploadDocument).toHaveBeenCalledTimes(1)
    expect(vi.mocked(uploadDocument).mock.calls[0]?.[1]).toMatchObject({ originConversationId: 's_conv_1' })

    vi.clearAllMocks()
    vi.mocked(requireMayFileFrom).mockRejectedValueOnce(new ConversationConfinedError('personalShelf', 'nein'))
    const refused = await callOperation(op, body({ projectId: 'proj-1', originConversationId: 's_conv_1' }), session)
    expect(refused.status).toBe(403)
    expect(uploadDocument).not.toHaveBeenCalled()
  })

  it('is refused when the project shelf is asked for without projectId', async () => {
    const op = findOperation('document-upload')
    if (!op) throw new Error('document-upload is not in the catalog')
    const result = await callOperation(op, { body: { files: [{ name: 'a.pdf', contentBase64: 'YQ==' }], fields: {} } }, session)
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toMatch(/projectId/)
    expect(uploadDocument).not.toHaveBeenCalled()
  })

  it('asks for write access to the shelf before it looks at the chat’s folders', async () => {
    const op = findOperation('document-upload')
    if (!op) throw new Error('document-upload is not in the catalog')
    vi.mocked(requireShelfWrite).mockRejectedValueOnce(new ForbiddenError())
    const refused = await callOperation(
      op,
      {
        body: {
          files: [{ name: 'Plan.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }],
          fields: { projectId: 'proj-1', folderId: 'fold-1', originConversationId: 's_conv_1' },
        },
      },
      session,
    )
    expect(refused.status).toBe(403)
    expect(requireMayFileFrom).not.toHaveBeenCalled()
    expect(uploadDocument).not.toHaveBeenCalled()
  })
})
