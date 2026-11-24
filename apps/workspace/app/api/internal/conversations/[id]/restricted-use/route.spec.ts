/**
 * @vitest-environment node
 *
 * The agent's admission of a tool round's restricted collections (ADR-0087,
 * ADR-0088). Which ones a turn may draw on is its signed decision now
 * (ADR-0194), so the route only admits. The rule itself is
 * `restricted-use.spec.ts` and, against Postgres,
 * `restricted-use.integration.spec.ts`; here, that the route asks it in the
 * stated organization, answers in the agent's shape, and holds its bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn() }))
vi.mock('@/lib/db/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn((_scope: unknown, run: () => Promise<unknown>) => run()),
}))
vi.mock('@/lib/conversations/restricted-use', () => ({
  ADMISSION_MAX_COLLECTIONS: 20,
  admitRestrictedUse: vi.fn(),
}))

import { admitRestrictedUse } from '@/lib/conversations/restricted-use'
import { withTenant } from '@/lib/db/tenant-context'
import { POST } from './route'

const TOKEN = 'a-real-secret-token'
const CONVERSATION_ID = 's_7d1e2c3b_0000_4000_8000_00000000000c'
const ORG_ID = 'org_1'
const ASKER = 'user_me'
const CONTRACTS = 'proj_abc_r0123456789ab'

const ask = (body: unknown, token: string = TOKEN, id: string = CONVERSATION_ID) =>
  POST(
    new Request(`https://example.test/api/internal/conversations/${id}/restricted-use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-grid-internal-token': token },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )

const ANSWER_ID = '0b7c6d2e-5f1a-5c3b-9d4e-8f7a6b5c4d3e'
const REQUEST = {
  organizationId: ORG_ID,
  conversationId: CONVERSATION_ID,
  userId: ASKER,
  projectId: 'proj-1',
  answerMessageId: null,
}

beforeEach(() => {
  vi.stubEnv('INTERNAL_API_TOKEN', TOKEN)
  vi.mocked(admitRestrictedUse).mockResolvedValue({ admitted: [CONTRACTS], refused: [], recorded: ['folder-vertraege'] })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('POST /api/internal/conversations/[id]/restricted-use', () => {
  it('admits a tool round’s collections in the stated organization and hands back the admission', async () => {
    const response = await ask({ organizationId: ORG_ID, userId: ASKER, projectId: 'proj-1', admit: [CONTRACTS] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ admitted: [CONTRACTS], refused: [], recorded: ['folder-vertraege'] })
    expect(withTenant).toHaveBeenCalledWith({ organizationId: ORG_ID }, expect.any(Function))
    expect(admitRestrictedUse).toHaveBeenCalledWith(REQUEST, [CONTRACTS])
  })

  it('hands the answer the turn writes to the admission', async () => {
    await ask({ organizationId: ORG_ID, userId: ASKER, projectId: 'proj-1', admit: [CONTRACTS], answerMessageId: ANSWER_ID })
    expect(admitRestrictedUse).toHaveBeenCalledWith({ ...REQUEST, answerMessageId: ANSWER_ID }, [CONTRACTS])
  })

  it('no longer answers the turn-start pre-check: a call with candidates and nothing to admit is refused', async () => {
    const response = await ask({ organizationId: ORG_ID, userId: ASKER, projectId: 'proj-1', candidates: [CONTRACTS] })
    expect(response.status).toBe(400)
    expect(admitRestrictedUse).not.toHaveBeenCalled()
  })

  it('refuses an answer id that is not one the agent mints', async () => {
    const response = await ask({ organizationId: ORG_ID, userId: ASKER, admit: [CONTRACTS], answerMessageId: 'not-a-uuid' })
    expect(response.status).toBe(400)
    expect(admitRestrictedUse).not.toHaveBeenCalled()
  })

  it('refuses a caller without the internal token, and asks nothing', async () => {
    const response = await ask({ organizationId: ORG_ID, userId: ASKER, admit: [CONTRACTS] }, 'wrong-token')
    expect(response.status).toBe(403)
    expect(admitRestrictedUse).not.toHaveBeenCalled()
  })

  it('refuses an asker it was not told, and an id too long to record', async () => {
    expect((await ask({ organizationId: ORG_ID, admit: [CONTRACTS] })).status).toBe(400)
    expect((await ask({ organizationId: ORG_ID, userId: ASKER, admit: [CONTRACTS] }, TOKEN, 's_'.padEnd(129, 'x'))).status).toBe(400)
    expect(admitRestrictedUse).not.toHaveBeenCalled()
  })

  it('bounds how many collections one call may name', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `proj_abc_r${String(i).padStart(12, '0')}`)
    expect((await ask({ organizationId: ORG_ID, userId: ASKER, admit: many })).status).toBe(400)
  })
})
