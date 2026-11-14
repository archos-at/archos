/**
 * @vitest-environment node
 */
/**
 * `/api/base-knowledge`: the office's own standards answer only for an office
 * with the `office-standards` entitlement. Off, the list and a proposal are not
 * found, before the service runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = {
  userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1A',
  organizationId: 'org_1',
  email: 'lena@example.test',
  role: 'member',
  permissions: [] as string[],
  featureFlags: ['office-standards'] as string[],
}

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockImplementation(async () => session),
  authzErrorResponse: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/base-knowledge/office/service', () => ({
  listBaseKnowledge: vi.fn().mockResolvedValue({ entries: [] }),
  proposeBaseKnowledge: vi.fn().mockResolvedValue({ id: 'entry-1' }),
}))

vi.mock('@/lib/base-knowledge/http/idempotency', () => ({
  onceForKey: vi.fn(async (_key: unknown, run: () => Promise<unknown>) => run()),
}))

import { listBaseKnowledge, proposeBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { GET, POST } from './route'

const ctx = { params: Promise.resolve({}) }
const propose = () =>
  POST(
    new Request('http://localhost/api/base-knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }),
    }),
    ctx,
  )

beforeEach(() => {
  vi.clearAllMocks()
  // Where people sign in, WorkOS states the flag on the session.
  vi.stubEnv('REQUIRE_AUTH', 'true')
  session.featureFlags = ['office-standards']
})

afterEach(() => vi.unstubAllEnvs())

describe('/api/base-knowledge behind office-standards', () => {
  it('lists the office’s standards when the office has them', async () => {
    const res = await GET(new Request('http://localhost/api/base-knowledge'), ctx)
    expect(res.status).toBe(200)
    expect(listBaseKnowledge).toHaveBeenCalled()
  })

  it('is not found with the flag off, and the service never runs', async () => {
    session.featureFlags = []
    const listed = await GET(new Request('http://localhost/api/base-knowledge'), ctx)
    expect(listed.status).toBe(404)
    expect(listed.headers.get('Content-Type')).toContain('application/problem+json')
    expect((await propose()).status).toBe(404)
    expect(listBaseKnowledge).not.toHaveBeenCalled()
    expect(proposeBaseKnowledge).not.toHaveBeenCalled()
  })

  it('is not found where nobody signs in: an entitlement is off there', async () => {
    vi.stubEnv('REQUIRE_AUTH', '')
    expect((await GET(new Request('http://localhost/api/base-knowledge'), ctx)).status).toBe(404)
  })
})
