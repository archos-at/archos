/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/personal-memory/service', () => ({ forgetPersonalMemoryItem: vi.fn() }))
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { withTenant } from '@/lib/db/tenant-context'
import { forgetPersonalMemoryItem } from '@/lib/personal-memory/service'
import { buildRequestContextEnvelopeHeaders } from '@/lib/request-context'
import { POST } from './route'

const SECRET = 'personal-memory-test-token' // pragma: allowlist secret
const SESSION = {
  userId: 'user_1', organizationId: 'org_1', email: 'requester@example.test', name: null,
  organizationMembershipId: 'om_1', role: 'member', permissions: [],
  accessToken: '', featureFlags: null,
}
const OWNER = { organizationId: 'org_1', userId: 'user_1' }
const BODY = { content: 'Mit „Lord“ ansprechen.' }

function signedHeaders() {
  return buildRequestContextEnvelopeHeaders({
    organizationId: 'org_1', userId: 'user_1', conversationId: 's_conversation',
    issuedAt: Date.now(), contextTransport: 'bff',
  }, SECRET)
}

function call(body: unknown = BODY, headers: Record<string, string> = signedHeaders()) {
  return POST(new Request('https://grid.test/api/internal/personal-memory/forget', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': SECRET, ...headers },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_API_TOKEN = SECRET
  vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(SESSION)
  vi.mocked(forgetPersonalMemoryItem).mockResolvedValue({ removedId: 'note-1', refused: null })
})

describe('POST /api/internal/personal-memory/forget', () => {
  it('forgets the quoted note of the envelope’s person, as that person, and answers what it did', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ removedId: 'note-1', refused: null })
    expect(withTenant).toHaveBeenCalledWith(OWNER, expect.any(Function))
    expect(forgetPersonalMemoryItem).toHaveBeenCalledWith(OWNER, 'Mit „Lord“ ansprechen.')
  })

  it('is a 401 without the signed envelope', async () => {
    expect((await call(BODY, {})).status).toBe(401)
    expect(forgetPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it.each([
    ['names an owner', { ...BODY, userId: 'user_2' }],
    ['has no text', { content: ' ' }],
  ])('rejects a body that %s with a 400', async (_name, body) => {
    expect((await call(body)).status).toBe(400)
    expect(forgetPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('refuses a person who is no longer a member here with a 403', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(null)

    expect((await call()).status).toBe(403)
    expect(forgetPersonalMemoryItem).not.toHaveBeenCalled()
  })
})
