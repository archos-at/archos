/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const loadConfig = async () => {
  vi.resetModules()
  return (await import('../next.config')).nextConfig
}

describe('version skew protection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('names the deployment after the commit the image was built from', async () => {
    vi.stubEnv('GIT_SHA', ' abc123 ')
    expect((await loadConfig()).deploymentId).toBe('abc123')
  })

  it('has none in a local build, where there is no skew to guard', async () => {
    vi.stubEnv('GIT_SHA', '')
    expect((await loadConfig()).deploymentId).toBeUndefined()
  })
})
