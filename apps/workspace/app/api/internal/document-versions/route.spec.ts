// @disk-inputs: app/api/internal/document-versions/route.ts
/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/documents/agent-document', () => ({ fileAgentDocumentDraft: vi.fn() }))
vi.mock('@/lib/documents/agent-file', () => ({ fileAgentFileDraft: vi.fn() }))
vi.mock('@/lib/documents/agent-file-revision', () => ({
  reviseWithAgentWork: vi.fn(async (_session: unknown, input: { documentId: string }) => ({
    document: { id: input.documentId, folderId: null },
    version: { id: '22222222-2222-4222-8222-222222222222', state: 'draft' },
    forked: false,
  })),
}))
vi.mock('@/lib/documents/agent-folder', () => ({
  agentDestination: vi.fn(async (_session: unknown, _projectId: string, named: { folder?: string }) =>
    named.folder === undefined ? undefined : 'folder-einreichung',
  ),
}))
vi.mock('@/lib/documents/lifecycle', () => ({
  transitionDocumentVersion: vi.fn(),
  toDocumentVersionView: (value: unknown) => value,
}))
vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/db/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import { fileAgentFileDraft } from '@/lib/documents/agent-file'
import { reviseWithAgentWork } from '@/lib/documents/agent-file-revision'
import { AGENT_FILE_MAX_BYTES } from '@/lib/documents/agent-file-types'
import { transitionDocumentVersion } from '@/lib/documents/lifecycle'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { withTenant } from '@/lib/db/tenant-context'
import {
  REQUEST_CONTEXT_HEADER_NAMES,
  buildRequestContextEnvelope,
  REQUEST_CONTEXT_MAX_AGE_MS,
} from '@/lib/request-context'
import {
  AGENT_REACHABLE_OPS,
  DOCUMENT_VERSION_OPS,
  findDocumentVersionTransition,
  type DocumentVersionOp,
} from '@/lib/documents/lifecycle-types'
import { POST } from './route'

const SECRET = 'internal-token-for-tests' // pragma: allowlist secret
const DOC = '11111111-1111-4111-8111-111111111111'
const VERSION = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'

const AGENT_REQUEST_BODIES: Partial<Record<DocumentVersionOp, Record<string, unknown>>> = {
  create: {
    op: 'create',
    projectId: PROJECT,
    ref: 's_conv_1-aktenvermerk',
    title: 'Aktenvermerk',
    content: '# Aktenvermerk',
  },
  update: { op: 'update', documentId: DOC, versionId: VERSION, content: 'korrigiert', ifMatch: 'sha256:abc' },
  submit: { op: 'submit', documentId: DOC, versionId: VERSION },
}

const session = {
  userId: 'user_requester',
  email: 'r@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'admin' as const,
  permissions: [],
  featureFlags: null,
}

function envelopeHeaders(
  overrides: { issuedAt?: number; userId?: string; projectId?: string | null; collectionScope?: string[] } = {},
) {
  const { header, signature } = buildRequestContextEnvelope(
    {
      organizationId: 'org_1',
      userId: overrides.userId ?? 'user_requester',
      ...(overrides.projectId === null ? {} : { projectId: overrides.projectId ?? PROJECT }),
      ...(overrides.collectionScope ? { collectionScope: overrides.collectionScope } : {}),
      conversationId: 's_conv_1',
      issuedAt: overrides.issuedAt ?? Date.now(),
    },
    SECRET,
  )
  return {
    [REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]: header,
    [REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]: signature ?? '',
  }
}

function call(body: unknown, headers: Record<string, string> = envelopeHeaders()) {
  return POST(
    new Request('https://example.test/api/internal/document-versions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-grid-internal-token': SECRET,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', SECRET)
  vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(session)
  vi.mocked(fileAgentDocumentDraft).mockResolvedValue({
    documentId: DOC,
    version: { id: VERSION } as never,
    alreadyFiled: false,
    folderId: null,
  })
  vi.mocked(fileAgentFileDraft).mockResolvedValue({
    documentId: DOC,
    version: { id: VERSION } as never,
    alreadyFiled: false,
    folderId: null,
  })
})

describe('the origin conversation', () => {
  it('is stamped from the VERIFIED envelope and never from the body', async () => {
    await call({
      op: 'create',
      projectId: PROJECT,
      ref: 's_someone_elses-aktenvermerk',
      title: 'Aktenvermerk',
      content: '# Aktenvermerk',
    })

    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
      ref: 's_someone_elses-aktenvermerk',
      originConversationId: 's_conv_1',
    })
  })
})

describe('the project the body names must be the project the envelope names', () => {
  const draft = (projectId: string) => ({
    op: 'create' as const,
    projectId,
    ref: 's_conv_1-aktenvermerk',
    title: 'Aktenvermerk',
    content: '# Aktenvermerk',
  })

  it('files into the project both agree on', async () => {
    expect((await call(draft(PROJECT))).status).toBe(201)
  })

  it('refuses a body pointed at a DIFFERENT project, with a 400 and no filing', async () => {
    const other = '99999999-9999-4999-8999-999999999999'
    const response = await call(draft(other))

    expect(response.status).toBe(400)
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('constrains nothing when the envelope names no project', async () => {
    const other = '99999999-9999-4999-8999-999999999999'
    const response = await call(draft(other), envelopeHeaders({ projectId: null }))

    expect(response.status).toBe(201)
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({ projectId: other })
  })
})

describe('the op set is closed by the transition table, not by this file', () => {
  it('admits exactly the ops the transition table makes agent-reachable', async () => {
    for (const op of DOCUMENT_VERSION_OPS) {
      const response = await call(AGENT_REQUEST_BODIES[op] ?? { op })
      expect(response.status, op).toBe(AGENT_REACHABLE_OPS.includes(op) ? 201 : 400)
    }
  })

  it('leaves every content assertion to a person', () => {
    for (const op of ['approve', 'request_changes', 'reject', 'publish', 'upload'] as const) {
      expect(AGENT_REACHABLE_OPS).not.toContain(op as DocumentVersionOp)
    }
    expect(findDocumentVersionTransition('approved', 'publish')?.actor).toBe('human')
  })
})

describe('identity comes from the signed envelope, never from the body', () => {
  it('refuses a request with no envelope, before it reads the body', async () => {
    const response = await call({ op: 'submit', documentId: DOC, versionId: VERSION }, {})
    expect(response.status).toBe(401)
    expect(transitionDocumentVersion).not.toHaveBeenCalled()
  })

  it('refuses a tampered signature', async () => {
    const headers = envelopeHeaders()
    const signature = headers[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]
    headers[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG] =
      (signature[0] === '0' ? '1' : '0') + signature.slice(1)

    const response = await call({ op: 'submit', documentId: DOC, versionId: VERSION }, headers)

    expect(response.status).toBe(401)
  })

  it('refuses a replayed envelope once its window has passed', async () => {
    const response = await call(
      { op: 'submit', documentId: DOC, versionId: VERSION },
      envelopeHeaders({ issuedAt: Date.now() - REQUEST_CONTEXT_MAX_AGE_MS - 1000 }),
    )
    expect(response.status).toBe(401)
  })

  it('acts as the envelope’s user, resolved through the pinned session', async () => {
    await call({ op: 'submit', documentId: DOC, versionId: VERSION })

    expect(resolvePinnedRequesterSession).toHaveBeenCalledWith({
      userId: 'user_requester',
      email: null,
      organizationId: 'org_1',
    })
    expect(transitionDocumentVersion).toHaveBeenCalledWith(
      session,
      DOC,
      VERSION,
      'submit',
      expect.objectContaining({ actingHuman: false }),
    )
  })

  it('opens the tenant scope from the envelope’s organization', async () => {
    await call({ op: 'submit', documentId: DOC, versionId: VERSION })
    expect(withTenant).toHaveBeenCalledWith({ organizationId: 'org_1' }, expect.any(Function))
  })

  it('refuses a requester who is no longer a member', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(null)
    const response = await call({ op: 'submit', documentId: DOC, versionId: VERSION })
    expect(response.status).toBe(403)
  })
})

describe('the ops it does serve', () => {
  it('create files a draft and answers 201', async () => {
    const response = await call({
      op: 'create',
      projectId: PROJECT,
      ref: 's_conv_1-aktenvermerk',
      title: 'Aktenvermerk',
      content: '# Aktenvermerk',
    })

    expect(response.status).toBe(201)
    expect(fileAgentDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ session, ref: 's_conv_1-aktenvermerk', actingHuman: false }),
    )
  })

  it('update replaces a draft’s bytes with the If-Match it was given', async () => {
    await call({
      op: 'update',
      documentId: DOC,
      versionId: VERSION,
      content: 'korrigiert',
      ifMatch: 'sha256:abc',
    })

    expect(reviseWithAgentWork).toHaveBeenCalledWith(session, {
      documentId: DOC,
      work: { kind: 'markdown', content: 'korrigiert' },
      ifMatch: 'sha256:abc',
      overChanges: undefined,
      changeNote: undefined,
      agentFiledOnly: true,
      options: {
        request: expect.any(Request),
        actingHuman: false,
        origin: { conversationId: expect.any(String), locale: 'de' },
      },
    })
  })

  it('hands both writes the conversation, never the signed scope: what may leave is what the conversation USED (ADR-0088)', async () => {
    const restricted = 'proj_3333_r0123456789ab'
    const headers = envelopeHeaders({ collectionScope: ['oib_knowledge', 'proj_3333', restricted] })
    await call(
      { op: 'create', projectId: PROJECT, ref: 's_conv_1-honorar', title: 'Honorar', content: '# Honorar' },
      headers,
    )
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({ originConversationId: 's_conv_1' })
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).not.toHaveProperty('signedRestrictedCollections')

    await call(
      { op: 'update', documentId: DOC, versionId: VERSION, content: 'Honorar 48.000', ifMatch: 'sha256:abc' },
      headers,
    )
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1].options).toMatchObject({
      origin: { conversationId: 's_conv_1', locale: 'de' },
    })
  })

  it('refuses an op outside the union at the schema', async () => {
    const response = await call({ op: 'publish', documentId: DOC, versionId: VERSION })
    expect(response.status).toBe(400)
    expect(transitionDocumentVersion).not.toHaveBeenCalled()
  })

  it('refuses the internal token being absent', async () => {
    const response = await POST(
      new Request('https://example.test/api/internal/document-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...envelopeHeaders() },
        body: JSON.stringify({ op: 'submit', documentId: DOC, versionId: VERSION }),
      }),
    )
    expect(response.status).toBe(403)
  })
})

describe('files the agent made by running code', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
  const contentBase64 = Buffer.from(bytes).toString('base64')
  const createFile = (overrides: Record<string, unknown> = {}) => ({
    op: 'create_file',
    projectId: PROJECT,
    ref: 's_conv_1-kosten',
    title: 'Kostenschätzung',
    filename: 'Kostenschaetzung.docx',
    contentType: DOCX,
    contentBase64,
    ...overrides,
  })

  it('create_file files the decoded bytes as the envelope’s conversation and answers 201', async () => {
    const response = await call(createFile())

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ documentId: DOC, alreadyFiled: false, version: { id: VERSION } })
    const input = vi.mocked(fileAgentFileDraft).mock.calls[0][0]
    expect(input).toMatchObject({
      session,
      projectId: PROJECT,
      ref: 's_conv_1-kosten',
      title: 'Kostenschätzung',
      filename: 'Kostenschaetzung.docx',
      contentType: DOCX,
      actingHuman: false,
      originConversationId: 's_conv_1',
    })
    expect(input.bytes).toEqual(bytes)
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('create_file is held to the envelope’s project like create', async () => {
    const response = await call(createFile({ projectId: '99999999-9999-4999-8999-999999999999' }))
    expect(response.status).toBe(400)
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
  })

  it('create_file refuses content that is not base64, at the schema', async () => {
    const response = await call(createFile({ contentBase64: 'not base64!' }))
    expect(response.status).toBe(400)
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
  })

  it('create_file refuses a file over 25 MB with a message that says so', async () => {
    const response = await call(createFile({ contentBase64: Buffer.alloc(AGENT_FILE_MAX_BYTES + 3).toString('base64') }))
    expect([400, 413]).toContain(response.status)
    expect(JSON.stringify(await response.json())).toMatch(/25 MB/)
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
  })

  it('create_file without a content type is refused at the schema', async () => {
    const { contentType: _omitted, ...body } = createFile()
    expect((await call(body)).status).toBe(400)
  })

  it('update_file replaces a draft’s bytes with the If-Match it was given, as the conversation', async () => {
    const response = await call({
      op: 'update_file',
      documentId: DOC,
      versionId: VERSION,
      contentType: DOCX,
      contentBase64,
      ifMatch: 'sha256:abc',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ documentId: DOC, version: { id: VERSION } })
    expect(reviseWithAgentWork).toHaveBeenCalledWith(session, {
      documentId: DOC,
      work: { kind: 'file', file: { contentType: DOCX, bytes } },
      ifMatch: 'sha256:abc',
      overChanges: undefined,
      changeNote: undefined,
      agentFiledOnly: true,
      options: { request: expect.any(Request), actingHuman: false, origin: { conversationId: 's_conv_1', locale: 'de' } },
    })
  })

  it('update_file over a Fassung a person changed passes the person’s choice on', async () => {
    await call({
      op: 'update_file',
      documentId: DOC,
      versionId: VERSION,
      contentType: DOCX,
      contentBase64,
      ifMatch: 'sha256:abc',
      overChanges: true,
    })
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1]).toMatchObject({ overChanges: true, agentFiledOnly: true })
  })

  it('revise_file makes the next Fassung of a project document, with its Änderungsvermerk', async () => {
    const response = await call({
      op: 'revise_file',
      documentId: DOC,
      contentType: DOCX,
      contentBase64,
      changeNote: 'Fläche Raum 2.04 korrigiert',
    })
    expect(response.status).toBe(201)
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1]).toMatchObject({
      documentId: DOC,
      changeNote: 'Fläche Raum 2.04 korrigiert',
      agentFiledOnly: false,
    })
  })

  it('create_file files into the folder the agent named', async () => {
    vi.mocked(fileAgentFileDraft).mockResolvedValue({
      documentId: DOC,
      version: { id: VERSION, state: 'draft' } as never,
      alreadyFiled: false,
      folderId: 'folder-einreichung',
    })
    await call({
      op: 'create_file',
      projectId: PROJECT,
      ref: 's_conv_1-plan',
      title: 'Plan',
      folder: 'Einreichung',
      contentType: DOCX,
      contentBase64,
    })
    expect(vi.mocked(fileAgentFileDraft).mock.calls[0][0]).toMatchObject({ folderId: 'folder-einreichung' })
  })

  it('update_file without If-Match is refused at the schema', async () => {
    const response = await call({ op: 'update_file', documentId: DOC, versionId: VERSION, contentType: DOCX, contentBase64 })
    expect(response.status).toBe(400)
    expect(reviseWithAgentWork).not.toHaveBeenCalled()
  })
})
