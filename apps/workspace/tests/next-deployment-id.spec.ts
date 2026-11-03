/**
 * @vitest-environment node
 */
/**
 * A tab opened before a deploy posts server action ids the new build does not
 * know ("Failed to find Server Action"). `deploymentId` lets the client notice
 * the server is another build and reload, so it must follow the commit the
 * image was built from (`GIT_SHA`, a build arg of `deploy/Dockerfile`).
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
