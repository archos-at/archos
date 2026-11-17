/**
 * @vitest-environment node
 *
 * `project-profile-get` shows no derived Gebäudeklasse where the project's
 * knowledge context withholds law (ADR-0169's amendment), as
 * `classification-evaluate` answers: a class an earlier derivation wrote,
 * before the office lost its entitlement or the site moved abroad, is not shown
 * as if the law still gave it. Where law is named it is shown as stored.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { contextForPage, findProjectProfileInOrg } = vi.hoisted(() => ({ contextForPage: vi.fn(), findProjectProfileInOrg: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/base-knowledge/context/service', () => ({ contextForPage }))

import { getProjectProfile } from './profile-service'
import type { AuthorizedSession } from '@/lib/auth/types'

const NOW = '2026-11-10T09:00:00.000Z'
const SESSION = { organizationId: 'org_1', userId: 'user_1' } as unknown as AuthorizedSession
const DERIVED = {
  value: 3,
  status: 'unconfirmed',
  reason: 'Abgeleitet',
  source: 'agent_suggested',
  updatedAt: NOW,
  evidence: [{ kind: 'derivation', rule: 'building_class', citation: 'OIB-Richtlinien – Begriffsbestimmungen', inputs: [] }],
}

const gate = (state: 'core' | 'not_entitled') => ({ gate: { state, reason: null, leaves: [] } })

describe('getProjectProfile', () => {
  beforeEach(() => {
    findProjectProfileInOrg.mockResolvedValue({
      profileVersion: 2,
      profile: { facts: {}, goals: {}, unknowns: [], assumptions: { 'building_class@bldg1': DERIVED } },
    })
  })

  it('shows a derived class where the knowledge context names law', async () => {
    contextForPage.mockResolvedValue(gate('core'))
    expect((await getProjectProfile(SESSION, 'p1')).profile.assumptions['building_class@bldg1']).toEqual(DERIVED)
  })

  it('shows none where it withholds law', async () => {
    contextForPage.mockResolvedValue(gate('not_entitled'))
    const state = await getProjectProfile(SESSION, 'p1')
    expect(state.profile.assumptions['building_class@bldg1']).toBeUndefined()
    expect(state.profileVersion).toBe(2)
  })
})
