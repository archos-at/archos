/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workos/feature-flags', () => ({
  enabledPostAnswerStages: vi.fn().mockResolvedValue([]),
  isDeepResearchEnabledForOrg: vi.fn().mockResolvedValue(true),
  isTaskAutomationEnabledForOrg: vi.fn().mockResolvedValue(true),
  isOrgFeatureEnabled: vi.fn(),
}))
vi.mock('@/lib/projects/repository', () => ({ findProjectTenancy: vi.fn() }))
vi.mock('@/lib/api/handler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/handler')>('@/lib/api/handler')
  return { ...actual, internalApiRoute: (_name: string, handler: unknown) => handler }
})

import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { GET } from './route'

const call = (organizationId: string) =>
  (GET as unknown as (ctx: { request: Request }) => Promise<unknown>)({
    request: new Request(`http://localhost/api/internal/stages?organizationId=${organizationId}`),
  })

describe('/api/internal/stages features.folderCards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is the folder-cards flag of the organization asked about', async () => {
    vi.mocked(isOrgFeatureEnabled).mockImplementation(
      async (flag, org) => flag === 'folder-cards' && org === 'org_on'
    )

    expect(await call('org_on')).toMatchObject({ features: { folderCards: true } })
    expect(await call('org_off')).toMatchObject({ features: { folderCards: false } })
    expect(isOrgFeatureEnabled).toHaveBeenCalledWith('folder-cards', 'org_off')
  })
})

describe('/api/internal/stages features.licensedSeam', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is the licensed-seam flag of the organization asked about, off unless WorkOS says yes', async () => {
    vi.mocked(isOrgFeatureEnabled).mockImplementation(async (flag, org) => flag === 'licensed-seam' && org === 'org_on')

    expect(await call('org_on')).toMatchObject({ features: { licensedSeam: true, folderCards: false } })
    expect(await call('org_off')).toMatchObject({ features: { licensedSeam: false } })
    expect(isOrgFeatureEnabled).toHaveBeenCalledWith('licensed-seam', 'org_off')
  })
})

describe('/api/internal/stages features.timeEditions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is true for every office, and asks WorkOS nothing about it: the time-editions switch is gone (ADR-0175)', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(false)

    expect(await call('org_any')).toMatchObject({ features: { timeEditions: true } })
    expect(vi.mocked(isOrgFeatureEnabled).mock.calls.map(([flag]) => flag)).not.toContain('time-editions')
  })
})
