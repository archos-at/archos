/**
 * @vitest-environment node
 *
 * Where a model's project is, for the BIM rules (ADR-0169): the chain the
 * intake places it by, the geocoded Land included where the profile states none.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectIntakeRow } from '@/lib/db/schema/project-intakes'
import { placedProfile } from '@/lib/project-intake/setup-countries.fixtures'
import type { ProjectProfileState } from '@/lib/projects/repository'
import type { BimModelHeader } from './repository'

const findProjectProfileInOrg = vi.fn<(projectId: string, organizationId: string) => Promise<ProjectProfileState | null>>()
const findProjectIntake = vi.fn<(organizationId: string, projectId: string) => Promise<ProjectIntakeRow | null>>()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/project-intake/repository', () => ({ findProjectIntake }))
vi.mock('./repository', () => ({}))
vi.mock('./compliance-cache', () => ({}))

const { siteOfModel } = await import('./compliance-run')

const header = { projectId: 'project-1' } as BimModelHeader
const profileState = (facts: Parameters<typeof placedProfile>[0]) => ({ profile: placedProfile(facts) }) as ProjectProfileState
const intakeAt = (federalState: string | null) => ({ location: { federalState } }) as ProjectIntakeRow

describe('siteOfModel', () => {
  beforeEach(() => {
    findProjectProfileInOrg.mockReset()
    findProjectIntake.mockReset()
  })

  it('places an Austrian project by its geocoded Land when the profile names none', async () => {
    findProjectProfileInOrg.mockResolvedValue(profileState({ country: 'at' }))
    findProjectIntake.mockResolvedValue(intakeAt('styria'))

    expect(await siteOfModel(header, 'org-1')).toEqual({ chain: ['AT-6', 'AT'] })
    expect(findProjectIntake).toHaveBeenCalledWith('org-1', 'project-1')
  })

  it('places it by its country alone when there is no intake to read', async () => {
    findProjectProfileInOrg.mockResolvedValue(profileState({ country: 'at' }))
    findProjectIntake.mockResolvedValue(null)

    expect(await siteOfModel(header, 'org-1')).toEqual({ chain: ['AT'] })
  })

  it('has no site for a model in no project', async () => {
    expect(await siteOfModel({ projectId: null } as BimModelHeader, 'org-1')).toBeNull()
    expect(findProjectProfileInOrg).not.toHaveBeenCalled()
  })
})
