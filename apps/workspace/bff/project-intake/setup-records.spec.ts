/**
 * @vitest-environment node
 *
 * The one read of the setup records: released records first, and the build's
 * record for a country and purpose with none released. An incomplete read uses
 * no released record, so a half-read country never decides a class. The
 * records themselves are read in `setup-records.integration.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHIPPED_SETUP_RECORDS, withShippedFallback } from '@/lib/base-knowledge/rulesets/shipped'
import { AT_SETUP_RECORDS, AT_SETUP_VALUES } from './at-setup.fixtures'
import { GERMAN_RECORDS } from './setup-countries.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/store/rulesets', () => ({ readSetupRulesetsInForce: vi.fn() }))

import { readSetupRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import { readSetupRecords } from './setup-records'

const read = (rulesets: typeof AT_SETUP_RECORDS, extra: { unreadable?: string[]; truncated?: boolean } = {}) =>
  vi.mocked(readSetupRulesetsInForce).mockResolvedValue({ rulesets: [...rulesets], unreadable: extra.unreadable ?? [], truncated: extra.truncated ?? false })

const ids = (records: readonly { id: string }[]) => records.map((record) => record.id).sort()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('readSetupRecords', () => {
  it('reads the released records alone where they cover every purpose of the build’s country', async () => {
    read(AT_SETUP_RECORDS)
    expect(await readSetupRecords('org_a')).toEqual(AT_SETUP_RECORDS)
  })

  it('reads the build’s records, unchanged, where nothing is released', async () => {
    read([])
    expect(await readSetupRecords('org_a')).toEqual(SHIPPED_SETUP_RECORDS)
  })

  it('falls back per purpose: a released classification replaces only the shipped classification', async () => {
    read(AT_SETUP_RECORDS.filter((record) => record.values.purpose === 'classification'))
    expect(ids(await readSetupRecords('org_a'))).toEqual([
      'ruleset:at-oib-2023-building-class',
      'shipped:at-setup-fact-definitions',
      'shipped:at-setup-fact-sources',
    ])
  })

  it('keeps the build’s records beside another country’s released ones', async () => {
    read(GERMAN_RECORDS)
    expect(ids(await readSetupRecords('org_a'))).toEqual(ids([...GERMAN_RECORDS, ...SHIPPED_SETUP_RECORDS]))
  })

  it('uses no released record when the read is truncated, or a stored body cannot be read', async () => {
    read(GERMAN_RECORDS, { truncated: true })
    expect(await readSetupRecords('org_a')).toEqual(SHIPPED_SETUP_RECORDS)
    read(GERMAN_RECORDS, { unreadable: ['ruleset:x'] })
    expect(await readSetupRecords('org_a')).toEqual(SHIPPED_SETUP_RECORDS)
  })

  it('keeps the seed beside a record released for a Land only: another node, no ambiguity', async () => {
    const [classification] = AT_SETUP_RECORDS.filter((record) => record.values.purpose === 'classification')
    const vienna = { id: 'ruleset:vienna', values: { ...classification.values, territoryIds: ['AT-9'] } }
    read([vienna])
    expect(ids(await readSetupRecords('org_a'))).toEqual(ids([vienna, ...SHIPPED_SETUP_RECORDS]))
  })

  it('keeps the seed while the released record is not in force, and ends it the day a later one starts', () => {
    const [classification] = AT_SETUP_RECORDS.filter((record) => record.values.purpose === 'classification')
    const later = { id: 'ruleset:later', values: { ...classification.values, validFrom: '2027-01-01' } }
    const expired = { id: 'ruleset:expired', values: { ...classification.values, validFrom: '2020-01-01', validTo: '2023-05-01' } }
    const shippedClass = (records: readonly { id: string; values: { validTo: string | null } }[]) =>
      records.find((record) => record.id === 'shipped:at-oib-2023-building-class')
    expect(shippedClass(withShippedFallback([later], '2026-11-10'))?.values.validTo).toBe('2027-01-01')
    expect(shippedClass(withShippedFallback([expired], '2026-11-10'))?.values.validTo).toBeNull()
    expect(shippedClass(withShippedFallback([later], '2027-01-01'))).toBeUndefined()
  })

  it('ships exactly the records an operator proposes for Austria, so publishing them changes no answer', () => {
    for (const seed of SHIPPED_SETUP_RECORDS) expect(seed.values).toEqual(AT_SETUP_VALUES[seed.id.replace(/^shipped:/, '')])
    expect(SHIPPED_SETUP_RECORDS).toHaveLength(Object.keys(AT_SETUP_VALUES).length)
  })
})
