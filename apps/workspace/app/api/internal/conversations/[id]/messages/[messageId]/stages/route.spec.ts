/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn() }))
vi.mock('@/lib/conversations/agent-stage-frame', async (original) => ({
  ...(await original<typeof import('@/lib/conversations/agent-stage-frame')>()),
  recordAgentStageFrame: vi.fn(),
}))
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { NotFoundError } from '@/lib/api/errors'
import { recordAgentStageFrame } from '@/lib/conversations/agent-stage-frame'
import { withTenant } from '@/lib/db/tenant-context'
import { buildRequestContextEnvelopeHeaders, type RequestContextInput } from '@/lib/request-context'
import { PATCH } from './route'

const SECRET = 'stage-frame-test-token' // pragma: allowlist secret
const CONVERSATION_ID = 's_conversation'
const MESSAGE_ID = '4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f'
const BODY = {
  stage: 'memory_reflection',
  payload: { items: [{ id: 'mem-1', kind: 'decision', content: 'Fassade in Lärche.' }] },
}

function signedHeaders(overrides: RequestContextInput = {}) {
  return buildRequestContextEnvelopeHeaders(
    {
      organizationId: 'org_1', userId: 'user_1', projectId: 'proj_1',
      conversationId: CONVERSATION_ID, issuedAt: Date.now(), contextTransport: 'bff',
      ...overrides,
    },
    SECRET
  )
}

function call(
  body: unknown = BODY,
  headers: Record<string, string> = signedHeaders(),
  params = { id: CONVERSATION_ID, messageId: MESSAGE_ID }
) {
  return PATCH(
    new Request(`https://grid.test/api/internal/conversations/${params.id}/messages/${params.messageId}/stages`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-internal-token': SECRET, ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_API_TOKEN = SECRET
  vi.mocked(recordAgentStageFrame).mockResolvedValue({ id: MESSAGE_ID } as never)
})

describe('PATCH /api/internal/conversations/[id]/messages/[messageId]/stages', () => {
  it('stores the frame in the organization the envelope names', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(withTenant).toHaveBeenCalledWith({ organizationId: 'org_1' }, expect.any(Function))
    expect(recordAgentStageFrame).toHaveBeenCalledWith('org_1', CONVERSATION_ID, MESSAGE_ID, BODY)
  })

  it('refuses a call without a valid envelope, and one whose envelope names another conversation', async () => {
    expect((await call(BODY, {})).status).toBe(401)
    expect((await call(BODY, signedHeaders({ conversationId: 's_other' }))).status).toBe(400)
    expect((await call(BODY, signedHeaders({ conversationId: null }))).status).toBe(400)
    expect(recordAgentStageFrame).not.toHaveBeenCalled()
  })

  it('accepts only the memory reflection stage, and no extra key that could name a tenant', async () => {
    expect((await call({ ...BODY, stage: 'follow_ups' })).status).toBe(400)
    expect((await call({ ...BODY, organizationId: 'org_2' })).status).toBe(400)
    expect((await call(BODY, signedHeaders(), { id: CONVERSATION_ID, messageId: 'not-a-uuid' })).status).toBe(400)
    expect(recordAgentStageFrame).not.toHaveBeenCalled()
  })

  it('answers 404 while the answer row does not exist, so the agent retries', async () => {
    vi.mocked(recordAgentStageFrame).mockRejectedValue(new NotFoundError())

    expect((await call()).status).toBe(404)
  })
})
