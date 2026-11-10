/**
 * @vitest-environment node
 *
 * The one decision-table evaluator (ADR-0166): first hit under Kleene's logic.
 * The reference is a plain first-hit loop over `json-logic-js` on complete
 * facts; on partial facts the evaluator must decide only what every completion
 * decides, name only unknown facts, list every row a completion could pick, and
 * decide once the facts it named are answered.
 */

import fc from 'fast-check'
import jsonLogic from 'json-logic-js'
import { describe, expect, it } from 'vitest'
import {
  decisionTableSchema,
  type DecisionTable,
  type DecisionTableInput,
} from '@/lib/base-knowledge/wire/ruleset'
import {
  INPUTS,
  completion,
  condition,
  knownFacts,
  partialFacts,
} from '@/test-utils/ruleset-arbitraries'
import { evaluateDecisionTable, failingExamples } from './decision-table'

const RUNS = { numRuns: 1500, seed: 20261110 }

const table: fc.Arbitrary<DecisionTable> = fc
  .tuple(fc.array(condition, { minLength: 1, maxLength: 5 }), fc.boolean())
  .map(([conditions, hasOtherwise]) =>
    decisionTableSchema.parse({
      inputs: [...INPUTS],
      output: { type: 'code', codes: ['r0', 'r1', 'r2', 'r3', 'r4', 'else'] },
      rows: conditions.map((when, index) => ({ id: `r${index}`, when, then: `r${index}` })),
      otherwise: hasOtherwise ? { then: 'else' } : { undetermined: true },
    } satisfies DecisionTableInput)
  )

/** First hit over json-logic-js on complete facts: the row id, `null` for otherwise, `undefined` when none applies. */
function reference(
  decision: DecisionTable,
  facts: Record<string, unknown>
): string | null | undefined {
  const row = decision.rows.find(
    (candidate) => jsonLogic.apply(candidate.when as jsonLogic.RulesLogic, facts) === true
  )
  if (row) return row.id
  return 'then' in decision.otherwise ? null : undefined
}

function completed(facts: Record<string, unknown>, filler: Record<string, unknown>) {
  return {
    ...filler,
    ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null)),
  }
}

describe('the decision table evaluator', () => {
  it('on complete facts, picks the row the first-hit reference picks', () => {
    fc.assert(
      fc.property(table, knownFacts, (decision, facts) => {
        const result = evaluateDecisionTable(decision, facts)
        const expected = reference(decision, facts)
        if (expected === undefined)
          expect(result).toEqual({ status: 'undetermined', reason: 'no_row_applies' })
        else expect(result).toMatchObject({ status: 'decided', rowId: expected })
      }),
      RUNS
    )
  })

  it('on partial facts, decides only what every completion decides, and offers every row a completion picks', () => {
    fc.assert(
      fc.property(
        table,
        partialFacts,
        fc.infiniteStream(knownFacts),
        (decision, facts, fillers) => {
          const result = evaluateDecisionTable(decision, facts)
          for (const filler of fillers.take(8)) {
            const picked = reference(decision, completed(facts, filler))
            if (result.status === 'decided') expect(picked).toBe(result.rowId)
            else if (result.reason === 'unknown_inputs' && picked !== undefined) {
              expect(result.candidates.map((candidate) => candidate.rowId)).toContain(picked)
            } else if (result.reason === 'no_row_applies') expect(picked).toBeUndefined()
          }
        }
      ),
      RUNS
    )
  })

  it('names only unknown facts, in input order, and answering exactly those decides the table', () => {
    fc.assert(
      fc.property(table, partialFacts, fc.gen(), (decision, facts, generate) => {
        const result = evaluateDecisionTable(decision, facts)
        if (result.status !== 'undetermined' || result.reason !== 'unknown_inputs') return
        expect(result.unknownInputs.length).toBeGreaterThan(0)
        for (const key of result.unknownInputs) expect(facts[key], key).toBeNull()
        const order = INPUTS.map((input) => input.key)
        expect(
          [...result.unknownInputs].sort((a, b) => order.indexOf(a) - order.indexOf(b))
        ).toEqual(result.unknownInputs)
        const answered = evaluateDecisionTable(decision, {
          ...facts,
          ...generate(() => completion(result.unknownInputs)),
        })
        expect(answered.status === 'decided' || answered.reason === 'no_row_applies').toBe(true)
      }),
      RUNS
    )
  })
})

describe('a small table by hand', () => {
  const decision = decisionTableSchema.parse({
    inputs: [
      { key: 'storeys', type: 'number' },
      { key: 'detached', type: 'boolean' },
    ],
    output: { type: 'code', codes: ['low', 'detached', 'other'] },
    rows: [
      {
        id: 'low',
        when: { '<=': [{ var: 'storeys' }, 2] },
        then: 'low',
        provision: { citation: '§ 1' },
      },
      { id: 'detached', when: { var: 'detached' }, then: 'detached' },
    ],
    otherwise: { then: 'other' },
    examples: [
      { facts: { storeys: 1 }, expect: { then: 'low' } },
      { facts: { detached: true }, expect: { undeterminedBy: ['storeys'] } },
    ],
  } satisfies DecisionTableInput)

  it('decides with the row and its provision when the first applicable row is known', () => {
    expect(evaluateDecisionTable(decision, { storeys: 1 })).toEqual({
      status: 'decided',
      rowId: 'low',
      then: 'low',
      provision: { citation: '§ 1' },
    })
  })

  it('names exactly the missing input an earlier unknown row waits for, though a later row already holds', () => {
    expect(evaluateDecisionTable(decision, { detached: true })).toEqual({
      status: 'undetermined',
      reason: 'unknown_inputs',
      unknownInputs: ['storeys'],
      candidates: [
        { rowId: 'low', then: 'low' },
        { rowId: 'detached', then: 'detached' },
      ],
    })
  })

  it('does not ask for a fact once an earlier row is known to apply', () => {
    expect(evaluateDecisionTable(decision, { storeys: 2, detached: null })).toMatchObject({
      status: 'decided',
      rowId: 'low',
    })
  })

  it('reaches otherwise only when every row is known not to apply', () => {
    expect(evaluateDecisionTable(decision, { storeys: 5, detached: false })).toMatchObject({
      status: 'decided',
      rowId: null,
      then: 'other',
    })
    expect(evaluateDecisionTable(decision, { storeys: 5 })).toMatchObject({
      unknownInputs: ['detached'],
    })
  })

  it('runs its own examples', () => {
    expect(failingExamples(decision)).toEqual([])
    const wrong = { ...decision, examples: [{ facts: { storeys: 1 }, expect: { then: 'other' } }] }
    expect(failingExamples(wrong)).toHaveLength(1)
  })

  it('compares an example by value, whatever the order of its keys', () => {
    const bodies = decisionTableSchema.parse({
      inputs: [{ key: 'storeys', type: 'number' }],
      output: { type: 'bodies' },
      rows: [{ id: 'a', when: true, then: { bodies: [{ authorityId: 'x', role: 'decides' }] } }],
      otherwise: { undetermined: true },
      examples: [
        { facts: {}, expect: { then: { bodies: [{ role: 'decides', authorityId: 'x' }] } } },
      ],
    } satisfies DecisionTableInput)
    expect(failingExamples(bodies)).toEqual([])
  })

  it('refuses an example whose facts are undeclared or of the wrong type', () => {
    const bad = decisionTableSchema.safeParse({
      inputs: [{ key: 'storeys', type: 'number' }],
      output: { type: 'code', codes: ['low'] },
      rows: [],
      otherwise: { then: 'low' },
      examples: [{ facts: { height: 3, storeys: 'two' }, expect: { then: 'low' } }],
    })
    expect(bad.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['examples.0.facts.height', 'height is not a declared input'],
      ['examples.0.facts.storeys', 'fact storeys is not a number: "two"'],
    ])
  })

  it('refuses a table whose row answers what the output does not declare, or reads an undeclared fact', () => {
    const bad = decisionTableSchema.safeParse({
      inputs: [{ key: 'storeys', type: 'number' }],
      output: { type: 'code', codes: ['low'] },
      rows: [
        { id: 'a', when: { '<=': [{ var: 'height' }, 2] }, then: 'low' },
        { id: 'b', when: true, then: 'tall' },
      ],
      otherwise: { undetermined: true },
    })
    expect(bad.success).toBe(false)
    expect(bad.error?.issues.map((issue) => issue.message)).toEqual([
      'var height is not a declared input',
      'not a code the output declares',
    ])
  })
})
