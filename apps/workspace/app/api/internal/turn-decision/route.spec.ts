/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/conversation-context/turn-decision', () => ({ decideTurn: vi.fn() }))
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { decideTurn } from '@/lib/conversation-context/turn-decision'
import { buildRequestContextEnvelopeHeaders } from '@/lib/request-context'
import { POST } from './route'

const SECRET = 'turn-decision-route-secret'
const ANSWER = '5a5a5a5a-0000-4000-8000-000000000001'
const session = { userId: 'user_1', organizationId: 'org_1' } as AuthorizedSession

function call(headers: Record<string, string>, body: unknown = { answerMessageId: ANSWER }) {
  return POST(
    new Request('https://app.test/api/internal/turn-decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': SECRET, ...headers },
      body: JSON.stringify(body),
    }),
  )
}

const envelope = () =>
  buildRequestContextEnvelopeHeaders(
    { organizationId: 'org_1', userId: 'user_1', conversationId: 's_c', projectId: 'p1', issuedAt: Date.now() },
    SECRET,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', SECRET)
  vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(session)
  vi.mocked(decideTurn).mockResolvedValue({ decision: 'd', signature: 's'.repeat(64), body: {} as never })
})

describe('POST /api/internal/turn-decision', () => {
  it('decides the turn the verified envelope names, for the answer the agent names, and says how long it took', async () => {
    const response = await call(envelope())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'd', signature: 's'.repeat(64) })
    expect(decideTurn).toHaveBeenCalledWith(session, expect.objectContaining({ conversationId: 's_c', userId: 'user_1' }), ANSWER)
    expect(response.headers.get('Server-Timing')).toContain('decide')
  })

  it('refuses a call without a signed envelope, and an answer id that is not a uuid', async () => {
    expect((await call({})).status).toBe(401)
    expect((await call(envelope(), { answerMessageId: 'drop table' })).status).toBe(400)
    expect(decideTurn).not.toHaveBeenCalled()
  })
})
