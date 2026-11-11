/**
 * @vitest-environment node
 *
 * The setup records as ruleset bodies (ADR-0169): Austria's seeds parse, a body
 * serves only its own purpose, and a stored row reads back as the same record.
 */

import { describe, expect, it } from 'vitest'
import definitionsSeed from '@/lib/base-knowledge/rulesets/seeds/at-setup-fact-definitions.json'
import sourcesSeed from '@/lib/base-knowledge/rulesets/seeds/at-setup-fact-sources.json'
import { rulesetFromRow } from '@/lib/base-knowledge/store/rulesets'
import { rulesetValuesSchema } from './ruleset'
import { factDefinitionsSchema, factSourcesSchema } from './setup-facts'

describe('the setup records', () => {
  it('parses Austria’s seeds', () => {
    expect(rulesetValuesSchema.safeParse(definitionsSeed).success).toBe(true)
    expect(rulesetValuesSchema.safeParse(sourcesSeed).success).toBe(true)
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
