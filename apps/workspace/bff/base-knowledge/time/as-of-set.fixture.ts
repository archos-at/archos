/**
 * The fixed as-of set (ADR-0171, ticket 30): procedures whose answer to "which
 * edition applied when this was submitted" is known, each with the edition it
 * must name or the facts it must ask for. Synthetic works and rules
 * (`work:fixture-…`, provisions marked "fixture"): the shapes are the design's
 * (§3.6: a Land Stichtag, a transition in the shape of NÖ BO § 70, BauGB and
 * BayBO choosing separately, BauNVO by the plan's adoption), the content is
 * not a statement about any law.
 */

import type { ProcedureInput } from '@/lib/base-knowledge/wire/time'
import {
  procedureSchema,
  transitionTableSchema,
  type DatedEdition,
} from '@/lib/base-knowledge/wire/time'
import { rulesetValuesSchema, type RulesetValuesInput } from '@/lib/base-knowledge/wire/ruleset'
import type { StoredRuleset } from '../rulesets/select'
import type { WorkInTime } from './as-of'

const ruleset = (id: string, values: RulesetValuesInput): StoredRuleset => ({
  id,
  values: rulesetValuesSchema.parse(values),
})

/** A node's rule: the reference date is the filing day. */
export function filingRule(
  id: string,
  territoryId: string,
  extra: Partial<RulesetValuesInput> = {}
): StoredRuleset {
  return ruleset(id, {
    purpose: 'reference_date',
    territoryIds: [territoryId],
    validFrom: '2000-01-01',
    body: {
      kind: 'table',
      payloadSchema: 'decision_table.v1',
      payload: {
        inputs: [{ key: 'filed_on', type: 'date' }],
        output: { type: 'event', events: ['filed_on'] },
        rows: [
          {
            id: 'filed',
            when: { '<=': ['0000-01-01', { var: 'filed_on' }] },
            then: 'filed_on',
            provision: { citation: `fixture: Stichtag ${territoryId}` },
          },
        ],
        otherwise: { undetermined: true },
      },
    },
    ...extra,
  })
}

/** A plan-bound work: the edition in force when the governing plan was adopted (the BauNVO shape). */
const planRule = ruleset('rule-de-plan', {
  purpose: 'reference_date',
  territoryIds: ['DE'],
  workIds: ['work:fixture-land-use'],
  validFrom: '2000-01-01',
  body: {
    kind: 'table',
    payloadSchema: 'decision_table.v1',
    payload: {
      inputs: [{ key: 'governing_plan_adopted_on', type: 'date' }],
      output: { type: 'event', events: ['governing_plan_adopted_on'] },
      rows: [
        {
          id: 'plan',
          when: { '<=': ['0000-01-01', { var: 'governing_plan_adopted_on' }] },
          then: 'governing_plan_adopted_on',
        },
      ],
      otherwise: { undetermined: true },
    },
  },
})

const inheritsParent = ruleset('rule-de-by-inherits', {
  purpose: 'reference_date',
  territoryIds: ['DE-BY'],
  validFrom: '2000-01-01',
  body: { kind: 'inherits', inherits: 'parent' },
})

export const AS_OF_RULESETS: StoredRuleset[] = [
  filingRule('rule-at-9', 'AT-9'),
  filingRule('rule-at-3', 'AT-3'),
  filingRule('rule-de', 'DE'),
  planRule,
]

/** Old law for a procedure filed before the boundary and not decided before it (the shape of NÖ BO § 70). */
export const OLD_LAW_IF_PENDING = transitionTableSchema.parse({
  inputs: [
    { key: 'filed_on', type: 'date' },
    { key: 'boundary_from', type: 'date' },
    { key: 'decided', type: 'boolean' },
    { key: 'decided_on', type: 'date' },
  ],
  output: { type: 'code', codes: ['old_law', 'new_law'] },
  rows: [
    {
      id: 'filed-before-open-at-boundary',
      when: {
        and: [
          { '<': [{ var: 'filed_on' }, { var: 'boundary_from' }] },
          {
            or: [
              { '!': { var: 'decided' } },
              { '>=': [{ var: 'decided_on' }, { var: 'boundary_from' }] },
            ],
          },
        ],
      },
      then: 'old_law',
      provision: { citation: 'fixture: Übergangsbestimmung' },
    },
  ],
  otherwise: { then: 'new_law' },
})

const edition = (
  id: string,
  label: string,
  inForceFrom: string | null,
  inForceTo: string | null,
  transition: DatedEdition['transition'] = null
): DatedEdition => ({
  id,
  label,
  inForceFrom,
  inForceTo,
  transition,
})

export const WORKS: Record<string, WorkInTime> = {
  wien: {
    id: 'work:fixture-wien-bo',
    historyAvailableFrom: '2014-01-01',
    editions: [
      edition('edition:fixture-wien-bo-2014', 'LGBl. 2014/25', '2014-01-01', '2018-09-01'),
      edition('edition:fixture-wien-bo-2018', 'LGBl. 2018/37', '2018-09-01', '2024-01-01'),
      edition('edition:fixture-wien-bo-2024', 'LGBl. 2023/37', '2024-01-01', null),
    ],
  },
  noe: {
    id: 'work:fixture-noe-bo',
    historyAvailableFrom: null,
    editions: [
      edition('edition:fixture-noe-bo-2014', 'LGBl. 1/2015', '2015-02-01', '2023-01-01'),
      edition(
        'edition:fixture-noe-bo-2023',
        'LGBl. 2023/1',
        '2023-01-01',
        null,
        OLD_LAW_IF_PENDING
      ),
    ],
  },
  bayern: {
    id: 'work:fixture-bayern-bo',
    historyAvailableFrom: '2008-01-01',
    editions: [
      edition('edition:fixture-bayern-bo-2021', 'GVBl. 2021', '2021-02-01', '2025-01-01'),
      edition('edition:fixture-bayern-bo-2025', 'GVBl. 2025', '2025-01-01', null),
    ],
  },
  landUse: {
    id: 'work:fixture-land-use',
    historyAvailableFrom: '1962-01-01',
    editions: [
      edition('edition:fixture-land-use-1977', 'Fassung 1977', '1977-10-01', '1990-01-27'),
      edition('edition:fixture-land-use-1990', 'Fassung 1990', '1990-01-27', null),
    ],
  },
}

export interface AsOfCase {
  name: string
  work: keyof typeof WORKS
  chain: string[]
  procedure: ProcedureInput
  facts?: Record<string, unknown>
  rulesets?: StoredRuleset[]
  expect:
    { edition: string } | { asks: string[] } | { reason: string } | { choice: [string, string] }
}

/** The clock of the set: an open procedure's window runs to this day in Vienna. */
export const NOW = new Date('2026-11-10T09:00:00Z')

export const AS_OF_SET: AsOfCase[] = [
  {
    name: 'Wien: filed under the 2018 edition, decided under 2024: the filing edition applies',
    work: 'wien',
    chain: ['AT-9', 'AT'],
    procedure: { filedOn: '2023-06-01', decidedOn: '2024-03-01' },
    expect: { edition: 'LGBl. 2018/37' },
  },
  {
    name: 'Wien: filed on the first day of an edition',
    work: 'wien',
    chain: ['AT-9', 'AT'],
    procedure: { filedOn: '2024-01-01', decidedOn: 'pending' },
    expect: { edition: 'LGBl. 2023/37' },
  },
  {
    name: 'Wien: filed on the last day of an edition',
    work: 'wien',
    chain: ['AT-9', 'AT'],
    procedure: { filedOn: '2023-12-31' },
    expect: { edition: 'LGBl. 2018/37' },
  },
  {
    name: 'Wien: no filing day is asked for, never taken as today',
    work: 'wien',
    chain: ['AT-9', 'AT'],
    procedure: { decidedOn: '2024-03-01' },
    expect: { asks: ['filed_on'] },
  },
  {
    name: 'Wien: before the history held',
    work: 'wien',
    chain: ['AT-9', 'AT'],
    procedure: { filedOn: '2012-05-01' },
    expect: { reason: 'history_not_held' },
  },
  {
    name: 'NÖ: filed before the boundary, decided after it: the transition keeps the old law',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2022-10-01', decidedOn: '2023-04-01' },
    expect: { edition: 'LGBl. 1/2015' },
  },
  {
    name: 'NÖ: filed before the boundary, still open: the old law',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2022-10-01', decidedOn: 'pending' },
    expect: { edition: 'LGBl. 1/2015' },
  },
  {
    name: 'NÖ: filed and decided before the boundary',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2022-03-01', decidedOn: '2022-11-01' },
    expect: { edition: 'LGBl. 1/2015' },
  },
  {
    name: 'NÖ: filed after the boundary',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2023-02-01', decidedOn: 'pending' },
    expect: { edition: 'LGBl. 2023/1' },
  },
  {
    name: 'NÖ: decision unknown: asks only what can change it',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2022-10-01' },
    expect: { asks: ['decided', 'decided_on'] },
  },
  {
    name: 'NÖ: edition before the oldest held, no history date: not held',
    work: 'noe',
    chain: ['AT-3', 'AT'],
    procedure: { filedOn: '2010-10-01' },
    expect: { reason: 'history_not_held' },
  },
  {
    name: 'Bayern: no own rule and no inherits: the answer names no date',
    work: 'bayern',
    chain: ['DE-BY', 'DE'],
    procedure: { filedOn: '2024-11-01', decidedOn: '2025-03-01' },
    expect: { reason: 'no_reference_date_rule' },
  },
  {
    name: 'Bayern: inherits: parent takes the federal rule',
    work: 'bayern',
    chain: ['DE-BY', 'DE'],
    procedure: { filedOn: '2024-11-01', decidedOn: '2025-03-01' },
    rulesets: [...AS_OF_RULESETS, inheritsParent],
    expect: { edition: 'GVBl. 2021' },
  },
  {
    name: 'Land use: the edition in force when the governing plan was adopted',
    work: 'landUse',
    chain: ['DE'],
    procedure: { filedOn: '2024-11-01' },
    facts: { governing_plan_adopted_on: '1980-06-01' },
    expect: { edition: 'Fassung 1977' },
  },
  {
    name: 'Land use: plan date unknown: asks for it',
    work: 'landUse',
    chain: ['DE'],
    procedure: { filedOn: '2024-11-01' },
    expect: { asks: ['governing_plan_adopted_on'] },
  },
]

export const parseProcedure = (input: ProcedureInput) => procedureSchema.parse(input)
