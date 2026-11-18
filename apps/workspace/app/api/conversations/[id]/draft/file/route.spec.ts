/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'
import type { Conversation } from '@/lib/db/schema/conversations'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { DocumentListRow } from '@/lib/documents/repository'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'member',
    email: 'u@example.test',
    permissions: [],
  }),
}))

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: requireResourceAccessMock,
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

vi.mock('@/lib/conversations/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/repository')>()),
  findConversationInOrg: vi.fn(),
}))

vi.mock('@/lib/documents/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/repository')>()),
  findDocumentAuthoredByRef: vi.fn(),
  listProjectDocuments: vi.fn(),
}))

vi.mock('@/lib/documents/version-repository', () => ({
  findOpenVersion: vi.fn(),
}))

vi.mock('@/lib/documents/agent-document', () => ({
  fileAgentDocumentDraft: vi.fn(),
}))

vi.mock('@/lib/projects/folder-service', () => ({
  findProjectFolder: vi.fn(),
}))

import { findConversationInOrg } from '@/lib/conversations/repository'
import { filingReference } from '@/lib/conversations/draft-filing'
import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import { findDocumentAuthoredByRef, listProjectDocuments } from '@/lib/documents/repository'
import { findOpenVersion } from '@/lib/documents/version-repository'
import { findProjectFolder } from '@/lib/projects/folder-service'
import { POST } from './route'

const PROJECT = '33333333-3333-4333-8333-333333333333'
const DOC = '11111111-1111-4111-8111-111111111111'
const VERSION = '22222222-2222-4222-8222-222222222222'

const PATH = '/entwuerfe/aktenvermerk.md'
const TITLE = 'Aktenvermerk'

const fetchMock = vi.fn()

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/api/conversations/conv-1/draft/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'conv-1' }) },
  )

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id: 'conv-1',
    organizationId: 'org_1',
    projectId: PROJECT,
    ...overrides,
  }) as Conversation

describe('POST /api/conversations/[id]/draft/file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetchMock)
    requireResourceAccessMock.mockResolvedValue({ role: 'viewer' })
    vi.mocked(findConversationInOrg).mockResolvedValue(conversation())
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ path: PATH, content: '# Aktenvermerk\n', version: 2 }),
    })
    vi.mocked(findDocumentAuthoredByRef).mockResolvedValue(null)
    vi.mocked(listProjectDocuments).mockResolvedValue([])
    vi.mocked(fileAgentDocumentDraft).mockResolvedValue({
      documentId: DOC,
      version: { id: VERSION, state: 'draft' } as DocumentVersion,
      alreadyFiled: false,
      folderId: 'folder-1',
    })
    vi.mocked(findProjectFolder).mockResolvedValue({ id: 'folder-1', name: 'Berichte' } as never)
  })

  it('files the draft in the reader session under the shared reference', async () => {
    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      documentId: DOC,
      versionId: VERSION,
      state: 'draft',
      alreadyFiled: false,
      folderId: 'folder-1',
      folderName: 'Berichte',
    })
    expect(requireResourceAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', organizationId: 'org_1' }),
      'conversation',
      'conv-1',
      'viewer',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://backend:8000/v1/drafts/conv-1/entwuerfe/aktenvermerk.md')
    expect(init.headers['x-internal-token']).toBe('test-token')
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
      projectId: PROJECT,
      ref: 'conv-1-aktenvermerk',
      title: TITLE,
      content: '# Aktenvermerk\n',
      originConversationId: 'conv-1',
    })
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).not.toHaveProperty('actingHuman', false)
  })

  it('converges with the agent filing: an already-filed reference creates nothing', async () => {
    vi.mocked(findDocumentAuthoredByRef).mockResolvedValue({
      id: DOC,
      filename: 'piloti/x.md',
      folderId: 'folder-1',
    })
    vi.mocked(findOpenVersion).mockResolvedValue({ id: VERSION, state: 'draft' } as DocumentVersion)

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      documentId: DOC,
      versionId: VERSION,
      state: 'draft',
      alreadyFiled: true,
      folderId: 'folder-1',
      folderName: 'Berichte',
    })
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('refuses a reference whose version has left the writing states', async () => {
    vi.mocked(findDocumentAuthoredByRef).mockResolvedValue({
      id: DOC,
      filename: 'piloti/x.md',
      folderId: 'folder-1',
    })
    vi.mocked(findOpenVersion).mockResolvedValue({ id: VERSION, state: 'in_review' } as DocumentVersion)

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'already-submitted' },
    })
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('vetoes a same-name document the reference does not own, carrying that row', async () => {
    vi.mocked(listProjectDocuments).mockResolvedValue([
      { id: 'doc-9', filename: 'x.md', displayName: 'Aktenvermerk' } as DocumentListRow,
    ])

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'same-name', documentId: 'doc-9', displayName: 'Aktenvermerk' },
    })
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('files beside the same-name document on explicit confirmation', async () => {
    vi.mocked(listProjectDocuments).mockResolvedValue([
      { id: 'doc-9', filename: 'x.md', displayName: 'Aktenvermerk' } as DocumentListRow,
    ])

    const res = await post({ path: PATH, title: TITLE, force: true })

    expect(res.status).toBe(201)
    expect(fileAgentDocumentDraft).toHaveBeenCalled()
  })

  it('answers 404 without addressing the backend when the reader may not see the conversation', async () => {
    requireResourceAccessMock.mockRejectedValue(new NotFoundError())

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('answers 422 when the conversation has no project to file into', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue(conversation({ projectId: null }))

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(422)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('rejects a missing path with 400 before any gate or backend call', async () => {
    const res = await post({ title: TITLE })

    expect(res.status).toBe(400)
    expect(requireResourceAccessMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a backend 404 to 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(404)
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('maps a backend outage to 502, retryable from the card', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    const res = await post({ path: PATH, title: TITLE })

    expect(res.status).toBe(502)
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  describe('a folder and a name the person chose', () => {
    const FOLDER = '44444444-4444-4444-8444-444444444444'

    it('files into the chosen folder under the chosen name, with the draft’s own extension', async () => {
      vi.mocked(fileAgentDocumentDraft).mockResolvedValue({
        documentId: DOC,
        version: { id: VERSION, state: 'draft' } as DocumentVersion,
        alreadyFiled: false,
        folderId: FOLDER,
      })
      vi.mocked(findProjectFolder).mockResolvedValue({ id: FOLDER, name: 'Protokolle' } as never)

      const res = await post({ path: PATH, title: TITLE, folderId: FOLDER, name: 'Aktenvermerk Baustelle.docx' })

      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ folderId: FOLDER, folderName: 'Protokolle' })
      expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
        folderId: FOLDER,
        title: 'Aktenvermerk Baustelle.docx.md',
      })
    })

    it('files at the project root when the folder is null, and names it as the root', async () => {
      vi.mocked(fileAgentDocumentDraft).mockResolvedValue({
        documentId: DOC,
        version: { id: VERSION, state: 'draft' } as DocumentVersion,
        alreadyFiled: false,
        folderId: null,
      })

      const res = await post({ path: PATH, folderId: null, name: 'Notiz' })

      expect(await res.json()).toMatchObject({ folderId: null, folderName: null })
      expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({ folderId: null, title: 'Notiz.md' })
    })

    it('sanitises the name: no path, no control characters, no leading dots', async () => {
      await post({ path: PATH, folderId: null, name: '../Bau\u0007/Protokoll.md' })

      expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({ title: '-Bau-Protokoll.md' })
    })

    it('refuses a name that is only an extension, before anything is filed', async () => {
      const res = await post({ path: PATH, folderId: null, name: ' .md ' })

      expect(res.status).toBe(400)
      expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
    })

    it('refuses a folder id that is not an id', async () => {
      const res = await post({ path: PATH, folderId: 'Berichte', name: 'Notiz' })

      expect(res.status).toBe(400)
      expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
    })

    it('checks a same-name collision in the chosen folder only', async () => {
      vi.mocked(listProjectDocuments).mockResolvedValue([
        { id: 'elsewhere', filename: 'x.md', displayName: 'Notiz.md', folderId: 'other-folder' } as DocumentListRow,
      ])

      const res = await post({ path: PATH, folderId: FOLDER, name: 'Notiz' })
      expect(res.status).toBe(201)

      vi.mocked(listProjectDocuments).mockResolvedValue([
        { id: 'here', filename: 'x.md', displayName: 'Notiz.md', folderId: FOLDER } as DocumentListRow,
      ])
      const clash = await post({ path: PATH, folderId: FOLDER, name: 'Notiz' })
      expect(clash.status).toBe(409)
      expect(await clash.json()).toMatchObject({ details: { reason: 'same-name', documentId: 'here' } })
    })

    it('passes a refusal of the folder through: another project’s folder answers 404', async () => {
      vi.mocked(fileAgentDocumentDraft).mockRejectedValue(new NotFoundError('Folder not found'))

      const res = await post({ path: PATH, folderId: FOLDER, name: 'Notiz' })

      expect(res.status).toBe(404)
    })
  })
})

describe('filingReference — parity with the agent tier', () => {
  it('spells the reference the way file_draft does', () => {
    expect(filingReference('conv-1', '/entwuerfe/Aktenvermerk Fluchtweg.md')).toBe(
      'conv-1-aktenvermerk-fluchtweg',
    )
    expect(filingReference('conv-1', '/entwuerfe/Fluchtweglänge.md')).toBe('conv-1-fluchtwegl-nge')
    expect(filingReference('conv-1', 'notiz')).toBe('conv-1-notiz')
    expect(filingReference('conv-1', '/entwuerfe/---.md')).toBe('conv-1-draft')
  })

  it('bounds the reference like the agent tier', () => {
    expect(filingReference('c'.repeat(300), '/entwuerfe/a.md')).toHaveLength(200)
  })

})
