/**
 * @vitest-environment node
 *
 * The knowledge context's operations hold their guards (ADR-0173): a project's
 * base is confirmed only on the person's own yes, only as the server resolves
 * it now, and never over a release the person has not seen; a report of wrong
 * law only for a country the office reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { knowledgeContextForTurn, readOrganizationCountries, insertChangeRequest, requireProjectAccess, requirePersonDecision, inserted } =
  vi.hoisted(() => ({
    knowledgeContextForTurn: vi.fn(),
    readOrganizationCountries: vi.fn(),
    insertChangeRequest: vi.fn(async () => '00000000-0000-4000-8000-000000000001'),
    requireProjectAccess: vi.fn(),
    requirePersonDecision: vi.fn(),
    inserted: vi.fn(),
  }))
vi.mock('./service', () => ({ knowledgeContextForTurn }))
vi.mock('../platform/entitlements', () => ({ readOrganizationCountries }))
vi.mock('../platform/store', () => ({ insertChangeRequest }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess }))
vi.mock('@/lib/agent-api/person-decision', () => ({ requirePersonDecision }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: async (_scope: unknown, run: () => Promise<unknown>) => run() }))
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    insert: () => ({
      values: (row: unknown) => ({
        returning: async () => {
          inserted(row)
          return [{ id: '00000000-0000-4000-8000-000000000002', confirmedAt: new Date('2026-12-14T10:00:00Z') }]
        },
      }),
    }),
  }),
}))

import { ConflictError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { confirmProjectBase, reportBaseKnowledge } from './operations'

const SESSION = { organizationId: 'org_1', userId: 'user_1' } as AuthorizedSession
const CONTEXT = {
  gate: { state: 'core', reason: null, leaves: [] },
  packs: [{ packId: 'AT', seq: 41 }],
  chains: { 'AT-9': ['AT-9', 'AT'] },
  date: '2026-12-14',
  procedures: [],
  uses: [],
  retrieval: { countries: ['AT'] },
}

describe('project-base-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeContextForTurn.mockResolvedValue(CONTEXT)
    requirePersonDecision.mockReturnValue('app')
  })

  it('stores the base as the server resolves it, with the person’s decision source', async () => {
    await confirmProjectBase(SESSION, 'project_1', { packs: [{ packId: 'AT', seq: 41 }] })
    expect(requireProjectAccess).toHaveBeenCalledWith(SESSION, 'project_1', 'project:edit')
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project_1', decisionSource: 'app', packSeqs: { AT: 41 }, snapshot: expect.objectContaining({ chains: CONTEXT.chains }) }),
    )
  })

  it('refuses without the person’s own yes, and stores nothing', async () => {
    requirePersonDecision.mockImplementation(() => {
      throw new Error('PERSON_DECISION_REQUIRED')
    })
    await expect(confirmProjectBase(SESSION, 'project_1', { packs: [{ packId: 'AT', seq: 41 }] })).rejects.toThrow('PERSON_DECISION_REQUIRED')
    expect(inserted).not.toHaveBeenCalled()
  })

  it('refuses a confirmation of packs released over since the person read them (409)', async () => {
    await expect(confirmProjectBase(SESSION, 'project_1', { packs: [{ packId: 'AT', seq: 40 }] })).rejects.toBeInstanceOf(ConflictError)
    expect(inserted).not.toHaveBeenCalled()
  })

  it('refuses a base that reads nothing to confirm', async () => {
    knowledgeContextForTurn.mockResolvedValue({ ...CONTEXT, gate: { state: 'not_entitled', reason: null, leaves: [] } })
    await expect(confirmProjectBase(SESSION, 'project_1', { packs: [{ packId: 'AT', seq: 41 }] })).rejects.toBeInstanceOf(UnprocessableError)
  })
})

describe('base-knowledge-report', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens a draft change request in an entitled country, titled with what is wrong', async () => {
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    const result = await reportBaseKnowledge(SESSION, { countryId: 'AT', workId: 'work:bo-wien', note: 'Novelle 2026 fehlt' })
    expect(result.status).toBe('draft')
    expect(insertChangeRequest).toHaveBeenCalledWith({ title: 'Report on work:bo-wien: Novelle 2026 fehlt', countryId: 'AT', createdBy: 'user_1' })
  })

  it('refuses a country the office does not read', async () => {
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    await expect(reportBaseKnowledge(SESSION, { countryId: 'DE', note: 'BayBO falsch' })).rejects.toBeInstanceOf(UnprocessableError)
    expect(insertChangeRequest).not.toHaveBeenCalled()
  })
})
