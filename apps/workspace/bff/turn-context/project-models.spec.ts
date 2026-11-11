import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnProjectModels } from './project-models'

vi.mock('@/lib/auth/auth-required', () => ({ isAuthRequired: vi.fn(() => true) }))

const HOLDS = { ifc: true, dxf: false, pdf: true }

afterEach(() => vi.clearAllMocks())

describe('the model kinds a turn states', () => {
  it('states a PDF only where the organization holds the drawing-measure entitlement', () => {
    expect(turnProjectModels(HOLDS, { featureFlags: ['drawing-measure'] })).toEqual({ ifc: true, dxf: false, pdf: true })
    expect(turnProjectModels(HOLDS, { featureFlags: ['deep-research'] })).toEqual({ ifc: true, dxf: false, pdf: false })
  })

  it('states none on a stale token, which carries no flags', () => {
    expect(turnProjectModels(HOLDS, { featureFlags: null })?.pdf).toBe(false)
  })

  it('never states a PDF the project does not hold, whatever the entitlement', () => {
    expect(turnProjectModels({ ifc: false, dxf: false, pdf: false }, { featureFlags: ['drawing-measure'] })?.pdf).toBe(false)
  })

  it('leaves the other kinds alone and an unread project unknown', () => {
    expect(turnProjectModels({ ifc: true, dxf: true, pdf: false }, { featureFlags: [] })).toEqual({ ifc: true, dxf: true, pdf: false })
    expect(turnProjectModels(null, { featureFlags: ['drawing-measure'] })).toBeNull()
  })

  it('is off where nobody signs in: an entitlement is never handed out there', async () => {
    const { isAuthRequired } = await import('@/lib/auth/auth-required')
    vi.mocked(isAuthRequired).mockReturnValue(false)
    expect(turnProjectModels(HOLDS, { featureFlags: ['drawing-measure'] })?.pdf).toBe(false)
  })
})
