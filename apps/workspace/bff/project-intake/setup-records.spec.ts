/**
 * @vitest-environment node
 *
 * The one read of the setup records fails closed (country-as-data, step 3): an
 * incomplete read gives no record at all, so a half-read country never decides
 * a class. The records themselves are read in `setup-records.integration.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/store/rulesets', () => ({ readSetupRulesetsInForce: vi.fn() }))

import { readSetupRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import { readSetupRecords } from './setup-records'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('readSetupRecords', () => {
  it('hands over the records it read', async () => {
    vi.mocked(readSetupRulesetsInForce).mockResolvedValue({ rulesets: [...AT_SETUP_RECORDS], unreadable: [], truncated: false })
    expect(await readSetupRecords('org_a')).toEqual(AT_SETUP_RECORDS)
  })

  it('gives none when the read is truncated, and none when a stored body cannot be read', async () => {
    vi.mocked(readSetupRulesetsInForce).mockResolvedValue({ rulesets: [...AT_SETUP_RECORDS], unreadable: [], truncated: true })
    expect(await readSetupRecords('org_a')).toEqual([])
    vi.mocked(readSetupRulesetsInForce).mockResolvedValue({ rulesets: [...AT_SETUP_RECORDS], unreadable: ['ruleset:x'], truncated: false })
    expect(await readSetupRecords('org_a')).toEqual([])
  })
})
