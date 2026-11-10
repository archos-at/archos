/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({
  findOrganization: vi.fn(),
  placeOrganization: vi.fn(),
  createOrganizationRow: vi.fn(),
}))
const getOrganization = vi.fn()
vi.mock('@/lib/workos/client', () => ({ getWorkOS: () => ({ organizations: { getOrganization } }) }))

import { ConflictError } from '@/lib/api/errors'
import type { Organization } from '@/lib/db/schema/organizations'
import { createOrganizationRow, findOrganization, placeOrganization } from './repository'
import { ensureOrganizationRow, homeCountryFromDirectory, stateHomeCountry, UNPLACED_RECHECK_MS } from './home-country-row'

const row = (homeCountry: string | null) => ({ workosOrganizationId: 'org', homeCountry }) as unknown as Organization
let next = 0
/** A fresh id per test: the module remembers which organizations it has seen placed. */
const orgId = () => `org_${++next}`

beforeEach(() => {
  vi.clearAllMocks()
  getOrganization.mockResolvedValue({ metadata: {} })
})

describe('ensureOrganizationRow (ADR-0158, review of #1545 fixes 2 and 4)', () => {
  it('writes the row of an organization that has none, with the country its WorkOS metadata names', async () => {
    vi.mocked(findOrganization).mockResolvedValue(null)
    getOrganization.mockResolvedValue({ metadata: { home_country: 'de' } })
    const id = orgId()
    await ensureOrganizationRow(id)
    expect(placeOrganization).toHaveBeenCalledWith(id, 'DE')
    expect(createOrganizationRow).not.toHaveBeenCalled()
  })

  it('writes a row without a country, and warns once, when nothing names it', async () => {
    vi.mocked(findOrganization).mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = orgId()
    await ensureOrganizationRow(id)
    await ensureOrganizationRow(id)
    expect(createOrganizationRow).toHaveBeenCalledWith(id)
    expect(placeOrganization).not.toHaveBeenCalled()
    expect(warn.mock.calls.filter(([message]) => String(message).includes('has no home country'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('asks an unplaced organization again only after a while, not on every page load', async () => {
    vi.mocked(findOrganization).mockResolvedValue(row(null))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = orgId()
    await ensureOrganizationRow(id, 0)
    await ensureOrganizationRow(id, UNPLACED_RECHECK_MS - 1)
    expect(findOrganization).toHaveBeenCalledTimes(1)
    expect(getOrganization).toHaveBeenCalledTimes(1)
    await ensureOrganizationRow(id, UNPLACED_RECHECK_MS + 1)
    expect(findOrganization).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('asks nothing more once the organization is placed', async () => {
    vi.mocked(findOrganization).mockResolvedValue(row('AT'))
    const id = orgId()
    await ensureOrganizationRow(id)
    await ensureOrganizationRow(id)
    expect(findOrganization).toHaveBeenCalledTimes(1)
    expect(getOrganization).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    vi.mocked(findOrganization).mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(ensureOrganizationRow(orgId())).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('homeCountryFromDirectory', () => {
  it('reads only a country the list offers', async () => {
    getOrganization.mockResolvedValue({ metadata: { home_country: 'fr' } })
    expect(await homeCountryFromDirectory(orgId())).toBeNull()
    getOrganization.mockRejectedValue(new Error('workos down'))
    expect(await homeCountryFromDirectory(orgId())).toBeNull()
  })
})

describe('stateHomeCountry', () => {
  it('states it once, takes the same again, and refuses a different one', async () => {
    vi.mocked(findOrganization).mockResolvedValue(row(null))
    await stateHomeCountry(orgId(), 'CH')
    expect(placeOrganization).toHaveBeenCalledTimes(1)

    vi.mocked(findOrganization).mockResolvedValue(row('CH'))
    await stateHomeCountry(orgId(), 'CH')
    expect(placeOrganization).toHaveBeenCalledTimes(1)
    await expect(stateHomeCountry(orgId(), 'AT')).rejects.toBeInstanceOf(ConflictError)
  })
})
