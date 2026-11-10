/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findOrganization = vi.hoisted(() => vi.fn())
vi.mock('./repository', () => ({ findOrganization }))
vi.mock('@/lib/cache', () => ({ getCached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load() }))
vi.mock('server-only', () => ({}))

import { isKnownTimeZone, officeTimeZone } from './time-zone'

describe('officeTimeZone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it("reads the office's own clock", async () => {
    findOrganization.mockResolvedValue({ timeZone: 'Europe/Berlin' })
    await expect(officeTimeZone('org_1')).resolves.toBe('Europe/Berlin')
  })

  it('is Europe/Vienna for a row without one, or no row', async () => {
    findOrganization.mockResolvedValue({ timeZone: null })
    await expect(officeTimeZone('org_1')).resolves.toBe('Europe/Vienna')
    findOrganization.mockResolvedValue(null)
    await expect(officeTimeZone('org_1')).resolves.toBe('Europe/Vienna')
  })

  it('never uses a zone the runtime does not know', async () => {
    findOrganization.mockResolvedValue({ timeZone: 'Europe/Nowhere' })
    await expect(officeTimeZone('org_1')).resolves.toBe('Europe/Vienna')
    expect(isKnownTimeZone('Europe/Zurich')).toBe(true)
  })

  it('answers Europe/Vienna when the read fails, so the request that asked does not', async () => {
    findOrganization.mockRejectedValue(new Error('database down'))
    await expect(officeTimeZone('org_1')).resolves.toBe('Europe/Vienna')
    expect(console.warn).toHaveBeenCalled()
  })
})
