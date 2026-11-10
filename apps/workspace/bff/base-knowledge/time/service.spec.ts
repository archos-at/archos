/**
 * @vitest-environment node
 *
 * The as-of route's logic (ADR-0171): the flag, the three ways to ask, and the
 * fail-closed reads. The resolver is the real one on the real evaluator; only
 * the reads are stood in for (their SQL is `time.integration.spec.ts`'s).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({ readWorkInTime: vi.fn(), readTerritoryChain: vi.fn() }))
vi.mock('../store/rulesets', () => ({ readRulesetsInForce: vi.fn() }))
vi.mock('@/lib/project-profile/profile-service', () => ({ getProjectProfile: vi.fn() }))
vi.mock('@/lib/authz/feature-flags', async (original) => ({
  ...(await original<typeof import('@/lib/authz/feature-flags')>()),
  isFeatureEnabled: vi.fn(
    (session: { featureFlags: string[] | null }, flag: string) =>
      session.featureFlags?.includes(flag) ?? false
  ),
}))

import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getProjectProfile } from '@/lib/project-profile/profile-service'
import { asOfQuerySchema } from '@/lib/base-knowledge/wire/time'
import { readRulesetsInForce } from '../store/rulesets'
import { AS_OF_RULESETS, NOW, WORKS } from './as-of-set.fixture'
import { readTerritoryChain, readWorkInTime } from './repository'
import { editionAsOfForSession, TimeEditionsDisabledError } from './service'

const MEMBER: AuthorizedSession = {
  userId: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [],
  featureFlags: ['time-editions'],
}
const FLAG_OFF: AuthorizedSession = { ...MEMBER, featureFlags: [] }

const ask = (session: AuthorizedSession, query: Record<string, string>) =>
  editionAsOfForSession(
    session,
    asOfQuerySchema.parse({ workId: WORKS.noe.id, territoryId: 'AT-3', ...query }),
    NOW
  )

beforeEach(() => {
  vi.mocked(readWorkInTime).mockResolvedValue({ work: WORKS.noe, unreadable: [], truncated: false })
  vi.mocked(readTerritoryChain).mockResolvedValue(['AT-3', 'AT'])
  vi.mocked(readRulesetsInForce).mockResolvedValue({
    rulesets: AS_OF_RULESETS,
    unreadable: [],
    truncated: false,
  })
})

describe('editionAsOfForSession', () => {
  it('answers 403 with the flag off, and reads nothing', async () => {
    vi.mocked(readWorkInTime).mockClear()
    await expect(ask(FLAG_OFF, { asOf: '2020-01-01' })).rejects.toBeInstanceOf(
      TimeEditionsDisabledError
    )
    expect(readWorkInTime).not.toHaveBeenCalled()
  })

  it('names the edition in force on a date (positive control)', async () => {
    const response = await ask(MEMBER, { asOf: '2020-01-01' })
    expect(response).toMatchObject({
      territoryChain: ['AT-3', 'AT'],
      asOf: '2020-01-01',
      answer: { status: 'determined', edition: { label: 'LGBl. 1/2015' } },
    })
  })

  it('names the edition that applied to a procedure given in the query, through its transition', async () => {
    const response = await ask(MEMBER, { filedOn: '2022-10-01', decidedOn: '2023-04-01' })
    expect(response.answer).toMatchObject({
      status: 'determined',
      edition: { label: 'LGBl. 1/2015' },
      transitions: [{ outcome: 'old_law' }],
    })
  })

  it('reads a procedure from the project’s profile, and refuses one the profile does not name', async () => {
    const fact = (value: string) => ({
      value,
      confidence: 'confirmed' as const,
      source: 'user_confirmed' as const,
      updatedAt: '2026-11-01',
    })
    vi.mocked(getProjectProfile).mockResolvedValue({
      profile: {
        facts: { 'filed_on@p1': fact('2023-02-01'), 'decided_on@p1': fact('pending') },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
    } as unknown as Awaited<ReturnType<typeof getProjectProfile>>)
    const response = await ask(MEMBER, { projectId: 'project-1', procedureId: 'p1' })
    expect(response.answer).toMatchObject({ edition: { label: 'LGBl. 2023/1' } })
    expect(getProjectProfile).toHaveBeenCalledWith(MEMBER, 'project-1')
    await expect(ask(MEMBER, { projectId: 'project-1', procedureId: 'p2' })).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('decides nothing from an incomplete read', async () => {
    vi.mocked(readWorkInTime).mockResolvedValue({
      work: WORKS.noe,
      unreadable: ['edition:x'],
      truncated: false,
    })
    expect((await ask(MEMBER, { asOf: '2020-01-01' })).answer).toEqual({
      status: 'undetermined',
      reason: 'records_unreadable',
      recordIds: ['edition:x'],
    })
    vi.mocked(readWorkInTime).mockResolvedValue({
      work: WORKS.noe,
      unreadable: [],
      truncated: false,
    })
    vi.mocked(readRulesetsInForce).mockResolvedValue({
      rulesets: [],
      unreadable: ['ruleset:y'],
      truncated: false,
    })
    expect((await ask(MEMBER, { filedOn: '2022-10-01' })).answer).toMatchObject({
      reason: 'records_unreadable',
      recordIds: ['ruleset:y'],
    })
  })

  it('answers 404 for a work the office does not read', async () => {
    vi.mocked(readWorkInTime).mockResolvedValue(null)
    await expect(ask(MEMBER, { asOf: '2020-01-01' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('asOfQuerySchema', () => {
  const parse = (query: Record<string, string>) =>
    asOfQuerySchema.safeParse({ workId: 'work:x', territoryId: 'AT-9', ...query }).success

  it('takes exactly one way of asking', () => {
    expect([
      parse({ asOf: '2020-01-01' }),
      parse({ filedOn: '2020-01-01' }),
      parse({ projectId: 'p', procedureId: 'p1' }),
    ]).toEqual([true, true, true])
    expect(parse({})).toBe(false)
    expect(parse({ asOf: '2020-01-01', filedOn: '2020-01-01' })).toBe(false)
    expect(parse({ projectId: 'p' })).toBe(false)
  })

  it('refuses a day that is not on the calendar', () => {
    expect(parse({ asOf: '2023-02-30' })).toBe(false)
    expect(parse({ asOf: '2024-02-29' })).toBe(true)
  })
})
