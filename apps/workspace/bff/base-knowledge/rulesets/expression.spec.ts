/**
 * @vitest-environment node
 *
 * The three-valued JsonLogic evaluator (ADR-0166), held to `json-logic-js`, the
 * reference implementation, wherever every fact is known, and to Kleene's
 * logic wherever one is not: a known answer survives every completion of the
 * unknown facts, and the facts an unknown answer waits for are enough to decide it.
 */

import fc from 'fast-check'
import jsonLogic from 'json-logic-js'
import { describe, expect, it } from 'vitest'
import {
  DECLARED,
  INPUTS,
  completion,
  condition,
  knownFacts,
  partialFacts,
} from '@/test-utils/ruleset-arbitraries'
import { RulesetEvaluationError, checkExpression, evaluateExpression, scopeOf } from './expression'

const run = (expression: unknown, facts: Record<string, unknown>) =>
  evaluateExpression(expression, scopeOf(INPUTS, facts))
const RUNS = { numRuns: 2000, seed: 20261110 }

describe('the generated conditions', () => {
  it('are all in the subset (a positive control for the generators)', () => {
    fc.assert(
      fc.property(condition, (expression) => {
        expect(checkExpression(expression, DECLARED)).toEqual([])
      }),
      RUNS
    )
  })
})

describe('on known facts', () => {
  it('agrees with json-logic-js', () => {
    fc.assert(
      fc.property(condition, knownFacts, (expression, facts) => {
        const result = run(expression, facts)
        expect(result).toEqual({
          known: true,
          value: jsonLogic.apply(expression as jsonLogic.RulesLogic, facts),
        })
      }),
      RUNS
    )
  })
})

describe('on unknown facts', () => {
  it('json-logic-js alone reads a missing fact as null and answers anyway: why the evaluation is ours', () => {
    const lowBuilding: jsonLogic.RulesLogic = { '<=': [{ var: 'storeys_above_ground' }, 3] }
    expect(jsonLogic.apply(lowBuilding, {})).toBe(true)
    expect(
      evaluateExpression(
        lowBuilding,
        scopeOf([{ key: 'storeys_above_ground', type: 'number' }], {})
      )
    ).toEqual({
      known: false,
      waitsFor: new Set(['storeys_above_ground']),
    })
  })

  it('decides only what every completion decides the same way', () => {
    fc.assert(
      fc.property(
        condition,
        partialFacts,
        fc.infiniteStream(knownFacts),
        (expression, facts, completions) => {
          const result = run(expression, facts)
          if (!result.known) return
          for (const filler of completions.take(8)) {
            const complete = {
              ...filler,
              ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null)),
            }
            expect(jsonLogic.apply(expression as jsonLogic.RulesLogic, complete)).toEqual(
              result.value
            )
          }
        }
      ),
      RUNS
    )
  })

  it('waits only for unknown facts, and answering exactly those decides it', () => {
    fc.assert(
      fc.property(condition, partialFacts, fc.gen(), (expression, facts, generate) => {
        const result = run(expression, facts)
        if (result.known) return
        const waitsFor = [...result.waitsFor]
        for (const key of waitsFor) expect(facts[key], key).toBeNull()
        const answered = { ...facts, ...generate(() => completion(waitsFor)) }
        expect(run(expression, answered).known).toBe(true)
      }),
      RUNS
    )
  })

  it('follows Kleene: false and unknown is false, true or unknown is true, not unknown is unknown', () => {
    const facts = { b1: null, b2: true }
    expect(run({ and: [{ var: 'b1' }, false] }, facts)).toEqual({ known: true, value: false })
    expect(run({ or: [{ var: 'b1' }, { var: 'b2' }] }, facts)).toEqual({ known: true, value: true })
    expect(run({ '!': { var: 'b1' } }, facts)).toEqual({ known: false, waitsFor: new Set(['b1']) })
    expect(run({ and: [{ var: 'b1' }, { '<': [{ var: 'n1' }, 2] }] }, facts)).toEqual({
      known: false,
      waitsFor: new Set(['b1', 'n1']),
    })
  })
})

describe('closed and typed: what it refuses rather than reads as false', () => {
  it.each([
    [{ if: [true, 1, 2] }, 'operator if is not in the subset'],
    [{ var: ['n1', 0] }, 'var takes 1 to 1 arguments, found 2'],
    [{ var: 'nope' }, 'var nope is not a declared input'],
    [{ var: '' }, 'var "" is only the element inside all, some or none'],
    [{ and: [true], or: [true] }, 'a JsonLogic node has one operator, found 2'],
    [{ in: ['a', [{ var: 'c1' }]] }, 'a list literal holds numbers, strings or booleans only'],
    [{ '>': [1, 2, 3] }, '> takes 2 to 2 arguments, found 3'],
  ])('%j', (expression, message) => {
    expect(checkExpression(expression, DECLARED)).toContain(message)
  })

  it('throws on a fact of another type than its input declares', () => {
    expect(() => scopeOf(INPUTS, { n1: '3' })).toThrow(RulesetEvaluationError)
    expect(() => scopeOf(INPUTS, { b1: 'yes' })).toThrow(RulesetEvaluationError)
    expect(() => scopeOf(INPUTS, { d1: '10.11.2026' })).toThrow(RulesetEvaluationError)
  })

  it('throws where JsonLogic would coerce: a number compared with a date, a code used as a boolean, division by zero', () => {
    expect(() => run({ '<': [{ var: 'n1' }, '2026-01-01'] }, { n1: 3 })).toThrow(
      RulesetEvaluationError
    )
    expect(() => run({ and: [{ var: 'c1' }] }, { c1: 'a' })).toThrow(RulesetEvaluationError)
    expect(() => run({ '/': [1, { var: 'n1' }] }, { n1: 0 })).toThrow(RulesetEvaluationError)
  })
})
