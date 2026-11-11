/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/personal-memory/service', () => ({ createPersonalMemoryItem: vi.fn() }))
// Which conversations are temporary (ADR-0180), keyed `organization/conversation` as the SQL scopes it.
const temporary = vi.hoisted(() => ({ conversations: new Set<string>() }))
vi.mock('@/lib/conversations/temporary-repository', () => ({
  readConversationTemporary: vi.fn(async (id: string, org: string) => temporary.conversations.has(`${org}/${id}`)),
}))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { withTenant } from '@/lib/db/tenant-context'
import { createPersonalMemoryItem } from '@/lib/personal-memory/service'
import { buildRequestContextEnvelopeHeaders, type RequestContextInput } from '@/lib/request-context'
import { POST } from './route'

const SECRET = 'personal-memory-test-token' // pragma: allowlist secret
const SESSION = {
  userId: 'user_1', organizationId: 'org_1', email: 'requester@example.test', name: null,
  organizationMembershipId: 'om_1', role: 'member', permissions: [],
  accessToken: '', featureFlags: null,
}
const OWNER = { organizationId: 'org_1', userId: 'user_1' }
const NOTE = { id: '11111111-1111-4111-8111-111111111111', kind: 'preference', content: 'Answers in short paragraphs.' }
const BODY = { kind: 'preference', content: 'Answers in short paragraphs.' }

function signedHeaders(overrides: RequestContextInput = {}) {
  return buildRequestContextEnvelopeHeaders({
    organizationId: 'org_1', userId: 'user_1', projectId: 'proj_1',
    conversationId: 's_conversation', issuedAt: Date.now(), contextTransport: 'bff',
    ...overrides,
  }, SECRET)
}

function call(body: unknown = BODY, headers: Record<string, string> = signedHeaders()) {
  return POST(new Request('https://grid.test/api/internal/personal-memory', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': SECRET, ...headers },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  temporary.conversations.clear()
  process.env.INTERNAL_API_TOKEN = SECRET
  vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(SESSION)
  vi.mocked(createPersonalMemoryItem).mockResolvedValue({ item: NOTE, created: true } as never)
})

describe('POST /api/internal/personal-memory', () => {
  it('keeps the note for the envelope’s person, as that person, and answers 201 { item, created }', async () => {
    const response = await call({ ...BODY, provenanceType: 'distillation', sourceConversationId: 's_conversation' })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ item: NOTE, created: true })
    expect(withTenant).toHaveBeenCalledWith(OWNER, expect.any(Function))
    expect(createPersonalMemoryItem).toHaveBeenCalledWith(OWNER, {
      kind: 'preference',
      content: 'Answers in short paragraphs.',
      provenanceType: 'distillation',
      sourceConversationId: 's_conversation',
      sourceMessageId: null,
    })
  })

  it('stores the answer the note was saved under, and refuses one that is no answer id or an owner in the body', async () => {
    const answer = '4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f'

    expect((await call({ ...BODY, sourceMessageId: answer })).status).toBe(201)
    expect(createPersonalMemoryItem).toHaveBeenCalledWith(OWNER, expect.objectContaining({ sourceMessageId: answer }))

    vi.mocked(createPersonalMemoryItem).mockClear()
    expect((await call({ ...BODY, sourceMessageId: 'the-first-answer' })).status).toBe(400)
    expect((await call({ ...BODY, sourceMessageId: answer, userId: 'user_2' })).status).toBe(400)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('defaults the provenance to agent and the conversation to the envelope’s, and says when the note already existed', async () => {
    vi.mocked(createPersonalMemoryItem).mockResolvedValue({ item: NOTE, created: false } as never)

    const response = await call()

    expect(response.status).toBe(201)
    expect((await response.json()).created).toBe(false)
    expect(createPersonalMemoryItem).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ provenanceType: 'agent', sourceConversationId: 's_conversation' })
    )
  })

  it('is a 401 without the signed envelope, and with one signed by another key', async () => {
    expect((await call(BODY, {})).status).toBe(401)
    const forged = buildRequestContextEnvelopeHeaders(
      { organizationId: 'org_1', userId: 'user_2', issuedAt: Date.now(), contextTransport: 'bff' },
      'another-token' // pragma: allowlist secret
    )
    expect((await call(BODY, forged)).status).toBe(401)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('refuses a caller without the service token before anything else', async () => {
    const response = await POST(new Request('https://grid.test/api/internal/personal-memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedHeaders() },
      body: JSON.stringify(BODY),
    }))

    expect(response.status).toBeGreaterThanOrEqual(401)
    expect(response.status).toBeLessThanOrEqual(403)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it.each([
    ['a userId', { userId: 'user_2' }],
    ['an organizationId', { organizationId: 'org_2' }],
    ['a pinned flag', { pinned: true }],
  ])('rejects a body that tries to name %s: the owner is the envelope’s person only', async (_name, extra) => {
    const response = await call({ ...BODY, ...extra })

    expect(response.status).toBe(400)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it.each([
    ['a provenance only a person has', { ...BODY, provenanceType: 'user' }],
    ['an unknown kind', { ...BODY, kind: 'decision' }],
    ['an empty text', { ...BODY, content: ' ' }],
    ['a text past 2,000 characters', { ...BODY, content: 'x'.repeat(2001) }],
    ['a conversation id past 255 characters', { ...BODY, sourceConversationId: 's'.repeat(256) }],
  ])('rejects %s with a 400', async (_name, body) => {
    expect((await call(body)).status).toBe(400)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('refuses a person who is no longer a member here with a 403', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(null)

    expect((await call()).status).toBe(403)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('refuses a write from a temporary conversation with 403 TEMPORARY_CONVERSATION and keeps nothing (ADR-0180)', async () => {
    temporary.conversations.add('org_1/s_temporary')

    const response = await call({ ...BODY, sourceConversationId: 's_temporary' })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('TEMPORARY_CONVERSATION')
    expect(body.error).toBe('This conversation is temporary: nothing from it is kept in memory')
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('refuses when the envelope’s conversation is temporary, whatever the body names or leaves out', async () => {
    temporary.conversations.add('org_1/s_conversation')

    expect((await call()).status).toBe(403)
    expect((await call({ ...BODY, sourceConversationId: 's_another' })).status).toBe(403)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('keeps a note from a conversation whose row does not exist yet, and from another organization’s temporary id', async () => {
    temporary.conversations.add('org_other/s_conversation')

    expect((await call()).status).toBe(201)
    expect((await call(BODY, signedHeaders({ conversationId: null }))).status).toBe(201)
    expect(createPersonalMemoryItem).toHaveBeenLastCalledWith(OWNER, expect.objectContaining({ sourceConversationId: null }))
  })
})
