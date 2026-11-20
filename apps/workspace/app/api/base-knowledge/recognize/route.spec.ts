/**
 * @vitest-environment node
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

vi.mock('@/lib/base-knowledge/office/recognition', () => ({
  recognizeUploads: vi.fn().mockResolvedValue({ proposals: [], plain: [], topics: { rootId: null, folders: [], nextCursor: null } }),
}))

import { recognizeUploads } from '@/lib/base-knowledge/office/recognition'
import { POST } from './route'

const ctx = { params: Promise.resolve({}) }
const DOCUMENT = '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const recognize = (body: unknown) =>
  POST(
    new Request('http://localhost/api/base-knowledge/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  session.featureFlags = ['office-standards']
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/base-knowledge/recognize', () => {
  it('hands the uploaded documents to the recognition', async () => {
    const res = await recognize({ documentIds: [DOCUMENT] })
    expect(res.status).toBe(200)
    expect(recognizeUploads).toHaveBeenCalledWith(session, { documentIds: [DOCUMENT] })
  })

  it('refuses a body without documents', async () => {
    expect((await recognize({ documentIds: [] })).status).toBe(400)
    expect(recognizeUploads).not.toHaveBeenCalled()
  })

  it('is not found with the flag off', async () => {
    session.featureFlags = []
    expect((await recognize({ documentIds: [DOCUMENT] })).status).toBe(404)
    expect(recognizeUploads).not.toHaveBeenCalled()
  })
})
