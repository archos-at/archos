/**
 * Synthetic setup records for Germany and Switzerland (ADR-0169): distinct
 * from Austria's in every field a project could see, so a spec can tell whose
 * record answered. Not law. The German table classifies by storeys alone and
 * the Swiss pack has no classification at all; neither ships.
 */

import { SHIPPED_SETUP_RECORDS } from '@/lib/base-knowledge/rulesets/shipped'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { rulesetValuesSchema, type RulesetValuesInput } from '@/lib/base-knowledge/wire/ruleset'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'

const record = (id: string, values: RulesetValuesInput): StoredRuleset => ({ id, values: rulesetValuesSchema.parse(values) })

const SOURCE = [{ title: 'Synthetic source for a spec', needsReview: true }]

export const GERMAN_RECORDS: readonly StoredRuleset[] = [
  record('test:de-fact-definitions', {
    purpose: 'fact_definitions',
    territoryIds: ['DE'],
    validFrom: '2020-01-01',
    body: {
      kind: 'fact_definitions',
      payloadSchema: 'fact_definitions.v1',
      payload: {
        subdivisions: {
          factKey: 'federal_state',
          label: 'Land (DE)',
          options: [
            { token: 'bavaria', territoryId: 'DE-BY', label: 'Bayern' },
            { token: 'berlin', territoryId: 'DE-BE', label: 'Berlin' },
          ],
        },
        facts: [{ key: 'storeys_above_ground', label: 'Geschosse (DE)', type: 'number' }],
        procedureTypes: [{ token: 'notice_procedure', label: 'Genehmigungsfreistellung' }],
        derivations: [
          {
            rule: 'building_class',
            citation: 'Synthetic MBO building class for a spec',
            values: { 'de-test:GK1': 1, 'de-test:GK3': 3, 'de-test:GK5': 5 },
          },
        ],
      },
    },
  }),
  record('test:de-classification', {
    purpose: 'classification',
    territoryIds: ['DE'],
    validFrom: '2020-01-01',
    body: {
      kind: 'table',
      payloadSchema: 'decision_table.v1',
      payload: {
        inputs: [{ key: 'storeys_above_ground', type: 'number' }],
        output: { type: 'code', codes: ['de-test:GK1', 'de-test:GK3', 'de-test:GK5'] },
        rows: [
          { id: 'low', when: { '<=': [{ var: 'storeys_above_ground' }, 2] }, then: 'de-test:GK1' },
          { id: 'mid', when: { '<=': [{ var: 'storeys_above_ground' }, 4] }, then: 'de-test:GK3' },
        ],
        otherwise: { then: 'de-test:GK5' },
      },
    },
  }),
  record('test:de-fact-sources', {
    purpose: 'fact_sources',
    territoryIds: ['DE'],
    validFrom: '2020-01-01',
    body: {
      kind: 'fact_sources',
      payloadSchema: 'fact_sources.v1',
      payload: {
        entries: [
          {
            id: 'zoning',
            determinant: 'zoning',
            label: 'Bebauungsplan (DE)',
            factKeys: ['zoning', 'development_plan'],
            request: { document: 'Auszug aus dem Bebauungsplan', reason: 'Synthetic reason (DE).' },
            sources: SOURCE,
            variants: { 'DE-BY': { document: 'Bebauungsplan der Gemeinde (BY)', sources: SOURCE } },
          },
          {
            id: 'storeys',
            label: 'Geschosse (DE)',
            factKeys: ['storeys_above_ground'],
            request: { document: 'Schnitt (DE)', reason: 'Synthetic reason for the storeys (DE).' },
            sources: SOURCE,
          },
        ],
      },
    },
  }),
]

export const SWISS_RECORDS: readonly StoredRuleset[] = [
  record('test:ch-fact-definitions', {
    purpose: 'fact_definitions',
    territoryIds: ['CH'],
    validFrom: '2020-01-01',
    body: {
      kind: 'fact_definitions',
      payloadSchema: 'fact_definitions.v1',
      payload: {
        subdivisions: {
          factKey: 'federal_state',
          label: 'Kanton',
          options: [{ token: 'zurich', territoryId: 'CH-ZH', label: 'Zürich' }],
        },
      },
    },
  }),
  record('test:ch-fact-sources', {
    purpose: 'fact_sources',
    territoryIds: ['CH'],
    validFrom: '2020-01-01',
    body: {
      kind: 'fact_sources',
      payloadSchema: 'fact_sources.v1',
      payload: {
        entries: [
          {
            id: 'plot',
            determinant: 'plot',
            label: 'Grundbuch (CH)',
            factKeys: ['plot_register_number', 'plot_area'],
            request: { document: 'Grundbuchauszug (CH)', reason: 'Synthetic reason (CH).' },
            sources: SOURCE,
          },
        ],
      },
    },
  }),
]

/** Austria's shipped records with Germany's and Switzerland's beside them: what every project selects from in a spec. */
export const THREE_COUNTRIES: readonly StoredRuleset[] = [...SHIPPED_SETUP_RECORDS, ...GERMAN_RECORDS, ...SWISS_RECORDS]

/** A profile placed by confirmed facts. */
export function placedProfile(facts: Record<string, ProjectPrimitiveValue>): ProjectProfile {
  const profile = emptyProjectProfile()
  for (const [key, value] of Object.entries(facts))
    profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-11-10T00:00:00Z' }
  return profile
}
