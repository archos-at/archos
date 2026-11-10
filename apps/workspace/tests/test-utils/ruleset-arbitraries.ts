/**
 * Generators for the evaluator's property specs: conditions in the subset over
 * one fixed set of typed inputs, and facts for them with any subset unknown.
 * Test-only; imported by `bff/base-knowledge/rulesets/*.spec.ts`.
 */

import fc from 'fast-check'
import type { FactType } from '@/lib/base-knowledge/wire/vocab'

export const INPUTS: readonly { key: string; type: FactType }[] = [
  { key: 'n1', type: 'number' },
  { key: 'n2', type: 'number' },
  { key: 'b1', type: 'boolean' },
  { key: 'b2', type: 'boolean' },
  { key: 'c1', type: 'code' },
  { key: 'd1', type: 'date' },
  { key: 'l1', type: 'codes' },
]

export const DECLARED: ReadonlyMap<string, FactType> = new Map(
  INPUTS.map((input) => [input.key, input.type])
)

const CODES = ['a', 'b', 'c'] as const
const DATES = ['2020-01-01', '2023-05-01', '2026-11-10'] as const

const valueOf: Record<FactType, fc.Arbitrary<unknown>> = {
  number: fc.integer({ min: -5, max: 5 }),
  boolean: fc.boolean(),
  code: fc.constantFrom(...CODES),
  date: fc.constantFrom(...DATES),
  codes: fc.subarray([...CODES]),
}

/** Every input known. */
export const knownFacts: fc.Arbitrary<Record<string, unknown>> = fc.record(
  Object.fromEntries(INPUTS.map((input) => [input.key, valueOf[input.type]]))
)

/** Any input may be unknown (`null`). */
export const partialFacts: fc.Arbitrary<Record<string, unknown>> = fc.record(
  Object.fromEntries(
    INPUTS.map((input) => [input.key, fc.option(valueOf[input.type], { nil: null, freq: 3 })])
  )
)

/** A value for each of `keys`, to complete facts where they are unknown. */
export function completion(keys: readonly string[]): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(
    Object.fromEntries(keys.map((key) => [key, valueOf[DECLARED.get(key) as FactType]]))
  )
}

const variable = (key: string) => ({ var: key })

const { number: numberExpression } = fc.letrec<{ number: unknown }>((tie) => ({
  number: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(variable('n1'), variable('n2')),
    fc.integer({ min: -5, max: 5 }),
    fc.tuple(tie('number'), tie('number')).map(([a, b]) => ({ '+': [a, b] })),
    fc.tuple(tie('number'), tie('number')).map(([a, b]) => ({ '-': [a, b] })),
    tie('number').map((a) => ({ '-': [a] })),
    fc.tuple(tie('number'), tie('number')).map(([a, b]) => ({ '*': [a, b] })),
    fc.tuple(tie('number'), fc.constantFrom(2, 4, -1)).map(([a, b]) => ({ '/': [a, b] })),
    fc.array(tie('number'), { minLength: 1, maxLength: 3 }).map((items) => ({ min: items })),
    fc.array(tie('number'), { minLength: 1, maxLength: 3 }).map((items) => ({ max: items }))
  ),
}))

const comparison = fc
  .tuple(fc.constantFrom('<', '<=', '>', '>=', '===', '!=='), numberExpression, numberExpression)
  .map(([op, a, b]) => ({ [op]: [a, b] }))

const leaf = fc.oneof(
  fc.constantFrom(variable('b1'), variable('b2'), true, false),
  comparison,
  fc
    .tuple(fc.constantFrom('<', '<='), numberExpression, numberExpression, numberExpression)
    .map(([op, a, b, c]) => ({ [op]: [a, b, c] })),
  fc
    .tuple(fc.constantFrom('<', '<=', '>', '>='), fc.constantFrom(...DATES))
    .map(([op, date]) => ({ [op]: [variable('d1'), date] })),
  fc.constantFrom(...CODES).map((code) => ({ '===': [variable('c1'), code] })),
  fc.subarray([...CODES]).map((list) => ({ in: [variable('c1'), list] })),
  fc.constantFrom(...CODES).map((code) => ({ in: [code, variable('l1')] })),
  fc
    .tuple(fc.constantFrom('all', 'some', 'none'), fc.subarray([...CODES]))
    .map(([op, list]) => ({ [op]: [variable('l1'), { in: [{ var: '' }, list] }] }))
)

/** A boolean condition in the subset over {@link INPUTS}. */
export const condition: fc.Arbitrary<unknown> = fc.letrec<{ condition: unknown }>((tie) => ({
  condition: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.array(tie('condition'), { minLength: 1, maxLength: 3 }).map((items) => ({ and: items })),
    fc.array(tie('condition'), { minLength: 1, maxLength: 3 }).map((items) => ({ or: items })),
    tie('condition').map((item) => ({ '!': [item] }))
  ),
})).condition
