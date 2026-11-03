/**
 * @vitest-environment node
 */
/**
 * Source maps are emitted only for the image build, which injects PostHog chunk
 * ids and keeps the maps out of the served trees (`deploy/Dockerfile`). The
 * running server loads `next.config.ts` too and must never emit or serve one.
 */
import { describe, expect, it } from 'vitest'
import { nextConfig, withSourceMaps } from '../next.config'

describe('source maps for error tracking', () => {
  it('turns browser and server maps on when the image build asks', () => {
    const config = withSourceMaps(nextConfig, { EMIT_SOURCE_MAPS: ' 1 ' })

    expect(config.productionBrowserSourceMaps).toBe(true)
    expect(config.experimental?.serverSourceMaps).toBe(true)
    // The rest of the config is the one as written.
    expect(config.deploymentId).toBe(nextConfig.deploymentId)
  })

  it('leaves the config as written for every other build and the server', () => {
    expect(withSourceMaps(nextConfig, {})).toBe(nextConfig)
    expect(withSourceMaps(nextConfig, { EMIT_SOURCE_MAPS: '0' })).toBe(nextConfig)
  })
})
