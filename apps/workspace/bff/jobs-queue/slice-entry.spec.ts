/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./hatchet', () => ({ startBffJobWorker: vi.fn() }))
vi.mock('./hatchet-run', () => ({ runBffJobTask: vi.fn(), dispatchStrandedJobs: vi.fn() }))
const shutdownPosthogServer = vi.fn()
vi.mock('@/lib/analytics/posthog-server', () => ({ shutdownPosthogServer: () => shutdownPosthogServer() }))
const bootstrapPlatformModelDefaults = vi.fn()
vi.mock('@/lib/model-config/bootstrap-defaults', () => ({
  bootstrapPlatformModelDefaults: () => bootstrapPlatformModelDefaults(),
}))

import { initSliceHost, shutdownSliceHost } from './slice-entry'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the host around the job worker', () => {
  it('provisions the platform default model at start, and survives it failing', async () => {
    bootstrapPlatformModelDefaults.mockRejectedValue(new Error('no table'))

    await expect(initSliceHost()).resolves.toBeUndefined()

    expect(bootstrapPlatformModelDefaults).toHaveBeenCalledTimes(1)
  })

  it('flushes PostHog at shutdown', async () => {
    await shutdownSliceHost()

    expect(shutdownPosthogServer).toHaveBeenCalledTimes(1)
  })
})
