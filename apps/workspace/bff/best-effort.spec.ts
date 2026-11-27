/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bestEffort, bestEffortInBackground } from './best-effort'
import { requireTenantContext, withTenant } from './db/tenant-context'

vi.mock('@/lib/analytics/posthog-server', () => ({
  getPosthogServer: () => null,
  serverEventIdentity: () => ({ distinctId: 'system', properties: {} }),
}))

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.restoreAllMocks())

describe('bestEffort', () => {
  it('answers what the work returns', async () => {
    expect(await bestEffort('read', async () => 7)).toBe(7)
  })

  it('answers null for an ordinary failure, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await bestEffort('read', async () => Promise.reject(new Error('upstream down')))).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('never swallows work run outside a tenant slot', async () => {
    await expect(bestEffort('read', async () => requireTenantContext())).rejects.toMatchObject({
      name: 'MissingTenantContextError',
    })
  })

  it('lets the same work through inside a slot', async () => {
    const scope = await withTenant({ organizationId: 'org-a' }, () => bestEffort('read', async () => requireTenantContext()))
    expect(scope).toMatchObject({ organizationId: 'org-a' })
  })
})

describe('bestEffortInBackground', () => {
  it('warns about an ordinary failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bestEffortInBackground('notify', async () => Promise.reject(new Error('socket closed')))
    await settle()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reports work run outside a tenant slot as an error, not a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    bestEffortInBackground('notify', async () => requireTenantContext())
    await settle()
    expect(warn).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('outside a tenant slot')
  })

  it('starts the work before it returns, and survives a synchronous throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const work = vi.fn(() => {
      throw new Error('bad input')
    })
    bestEffortInBackground('notify', work)
    expect(work).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })
})
