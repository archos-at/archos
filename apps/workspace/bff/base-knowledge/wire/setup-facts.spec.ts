/**
 * @vitest-environment node
 *
 * The setup records as ruleset bodies (ADR-0169): Austria's seeds parse, a body
 * serves only its own purpose, and a stored row reads back as the same record.
 */

import { describe, expect, it } from 'vitest'
import { AT_FACT_DEFINITIONS_VALUES as definitionsSeed, AT_FACT_SOURCES_VALUES as sourcesSeed } from '@/lib/project-intake/at-setup.fixtures'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'
import { proposedRecordSchema } from '@/lib/base-knowledge/platform/wire'
import pack from '../../../../../configs/knowledge-packs/at-setup.json'
import at from '../../../../../configs/knowledge-packs/at.json'
import { rulesetFromRow } from '@/lib/base-knowledge/store/rulesets'
import { rulesetValuesSchema } from './ruleset'
import { factDefinitionsSchema, factSourcesSchema } from './setup-facts'

describe('the setup records', () => {
  it('parses Austria’s records, as the door’s own wire reads them', () => {
    expect(rulesetValuesSchema.safeParse(definitionsSeed).success).toBe(true)
    expect(rulesetValuesSchema.safeParse(sourcesSeed).success).toBe(true)
    for (const record of pack.records) expect(proposedRecordSchema.safeParse({ ...record, citations: [{ note: 'spec' }] }).success, record.key).toBe(true)
    expect(pack.countryId).toBe('AT')
  })

  it('states Austria’s time zone on its territory record, which the time path reads', () => {
    const territory = at.records.find((record) => record.type === 'territory' && record.id === 'AT')
    expect(territory).toMatchObject({ zone: 'Europe/Vienna' })
    expect(proposedRecordSchema.safeParse({ ...territory, citations: [{ note: 'spec' }] }).success).toBe(true)
    // A zone the runtime does not know is refused at the door, never stored.
    expect(proposedRecordSchema.safeParse({ type: 'territory', id: 'AT', kind: 'country', name: 'x', zone: 'Mars/Olympus' }).success).toBe(false)
  })

  it('holds the site picker’s Länder to the released fact definitions (the one table still in code)', () => {
    if (definitionsSeed.body.kind !== 'fact_definitions') throw new Error('a fact_definitions body')
    const subdivisions = definitionsSeed.body.payload.subdivisions
    expect(SITE_SUBDIVISIONS.options.map(({ token, label, territoryId }) => ({ token, label, territoryId }))).toEqual(
      (subdivisions?.options ?? []).map(({ token, label, territoryId }) => ({ token, label, territoryId }))
    )
    expect(SITE_SUBDIVISIONS.outside).toBe(subdivisions?.outside?.token)
    expect(SITE_SUBDIVISIONS.country).toBe(definitionsSeed.territoryIds[0].toLowerCase())
  })

  it('reads an address register from a record, and refuses a pattern that is not anchored or does not compile', () => {
    const register = {
      id: 'xa-registry',
      publisher: 'Synthetic registry',
      municipalityTerritory: 'XA:code:{code}',
      postcodePattern: '^\\d{3}$',
      downloadUrl: 'https://registry.example.org/{yyyymmdd}.zip',
    }
    expect(factDefinitionsSchema.safeParse({ addressRegister: register }).success).toBe(true)
    expect(factDefinitionsSchema.safeParse({ addressRegister: { ...register, postcodePattern: '\\d{3}' } }).success).toBe(false)
    expect(factDefinitionsSchema.safeParse({ addressRegister: { ...register, postcodePattern: '^(\\d{3$' } }).success).toBe(false)
    expect(factDefinitionsSchema.safeParse({ addressRegister: { ...register, downloadUrl: 'https://registry.example.org/x.zip' } }).success).toBe(false)
  })

  it('refuses a body under another purpose', () => {
    const wrong = { ...sourcesSeed, purpose: 'fact_definitions' }
    const result = rulesetValuesSchema.safeParse(wrong)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/serves the purpose fact_sources/)
    // A decision purpose takes a table only.
    expect(rulesetValuesSchema.safeParse({ ...sourcesSeed, purpose: 'classification' }).success).toBe(false)
  })

  it('refuses a repeated subdivision, fact or entry, and codes on a number', () => {
    const subdivision = { token: 'vienna', territoryId: 'AT-9', label: 'Wien' }
    expect(
      factDefinitionsSchema.safeParse({
        subdivisions: { factKey: 'federal_state', label: 'Land', options: [subdivision, subdivision] },
      }).success
    ).toBe(false)
    expect(
      factDefinitionsSchema.safeParse({ facts: [{ key: 'storeys', label: 'x', type: 'number', codes: ['a'] }] }).success
    ).toBe(false)
    if (sourcesSeed.body.kind !== 'fact_sources') throw new Error('a fact_sources body')
    const entry = sourcesSeed.body.payload.entries[0]
    expect(factSourcesSchema.safeParse({ entries: [entry, entry] }).success).toBe(false)
    expect(factSourcesSchema.safeParse({ entries: [entry] }).success).toBe(true)
  })

  it('reads a stored setup row back as the record that was written', () => {
    const values = rulesetValuesSchema.parse(sourcesSeed)
    if (values.body.kind !== 'fact_sources') throw new Error('a fact_sources body')
    const row = {
      revisionId: 'rev-1',
      recordId: 'rec-1',
      ownerKey: 'org-1',
      purpose: values.purpose,
      territoryIds: values.territoryIds,
      workIds: values.workIds,
      validFrom: values.validFrom,
      validTo: values.validTo,
      basisEditionId: values.basisEditionId,
      basisEditionType: 'edition',
      inherits: null,
      payloadSchema: values.body.payloadSchema,
      payload: values.body.payload,
    } as unknown as Parameters<typeof rulesetFromRow>[0]
    expect(rulesetFromRow(row)).toEqual({ id: 'rec-1', values })
    // A payload the schema cannot read is left out, never half-read.
    expect(rulesetFromRow({ ...row, payload: { entries: [] } })).toBeNull()
  })
})
