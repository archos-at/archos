/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEffectiveModelOverrides } from './service'

vi.mock('server-only', () => ({}))

const getPlatformModelDefaults = vi.fn()
vi.mock('./platform-defaults', () => ({
  getPlatformModelDefaults: (): unknown => getPlatformModelDefaults(),
}))

vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
  invalidateCached: vi.fn(),
}))

const selectResults: unknown[][] = []
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => selectResults.shift() ?? [],
      }
      return chain
    },
  }),
}))

describe('getEffectiveModelOverrides', () => {
  beforeEach(() => {
    selectResults.length = 0
    getPlatformModelDefaults.mockReset()
  })

  const orgConfiguredNothing = (): void => {
    selectResults.push([])
  }

  const orgChose = (overrides: Record<string, { model: string }>): void => {
    selectResults.push([{ activeVersionId: 'version-1', updatedBy: 'user-1', updatedAt: new Date() }])
    selectResults.push([{ id: 'version-1', overrides }])
  }

  it('serves the platform default to an org that configured nothing', async () => {
    getPlatformModelDefaults.mockResolvedValue({ shallow_research: 'vendor/fast', deep_research: 'vendor/deep' })
    orgConfiguredNothing()

    expect(await getEffectiveModelOverrides('org_1')).toEqual({
      shallow_research: 'vendor/fast',
      deep_research: 'vendor/deep',
    })
  })

  it("keeps the org's own choice and inherits the default for every other group", async () => {
    getPlatformModelDefaults.mockResolvedValue({ shallow_research: 'vendor/fast', deep_research: 'vendor/deep' })
    orgChose({ deep_research: { model: 'org/chosen' } })

    expect(await getEffectiveModelOverrides('org_1')).toEqual({
      shallow_research: 'vendor/fast',
      deep_research: 'org/chosen',
    })
  })

  it('falls back to the org layer alone when the platform defaults cannot be read', async () => {
    getPlatformModelDefaults.mockRejectedValue(new Error('db down'))
    orgChose({ deep_research: { model: 'org/chosen' } })

    expect(await getEffectiveModelOverrides('org_1')).toEqual({ deep_research: 'org/chosen' })
  })

  it('returns null when neither layer says anything — the YAML models apply', async () => {
    getPlatformModelDefaults.mockResolvedValue({})
    orgConfiguredNothing()

    expect(await getEffectiveModelOverrides('org_1')).toBeNull()
  })
})
