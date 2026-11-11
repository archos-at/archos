/**
 * @vitest-environment node
 *
 * What a turn carries of a released source (`context/sources.ts`): the record a lookup reads, without the
 * fixtures that proved it, and nothing for a source no lookup reads or one too large to carry.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { lookupConfig } = await import('./sources')
const { MAX_SOURCE_CONFIG_CHARS } = await import('./wire')

const record = { id: 'xa-gazette', protocol: 'web_document', lookup: { language: 'en' }, fixtures: [{ name: 'code' }] }

describe('the configuration a turn carries of a source', () => {
  it('is the record without its fixtures', () => {
    expect(lookupConfig(record)).toEqual({ id: 'xa-gazette', protocol: 'web_document', lookup: { language: 'en' } })
  })

  it('is nothing for a source no lookup reads', () => {
    const { lookup: _none, ...plain } = record
    expect(lookupConfig(plain)).toBeNull()
  })

  it('is nothing for a record larger than a turn carries', () => {
    expect(lookupConfig({ ...record, engine: { padding: 'x'.repeat(MAX_SOURCE_CONFIG_CHARS) } })).toBeNull()
  })
})
