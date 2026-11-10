/**
 * A closed subset of JsonLogic (jsonlogic.com), evaluated under Kleene's
 * strong three-valued logic (ADR-0166). Pure.
 *
 * JsonLogic is the format: a condition is JSON a record can hold, a reviewer
 * can read and any JsonLogic library can run. No library evaluates it in three
 * values: each reads a missing variable as `null` and goes on, so
 * `{"<=": [{"var": "storeys"}, 3]}` is quietly true for a building whose
 * storeys nobody has entered. That is the one thing a classification may not
 * do, so the evaluation is ours and `json-logic-js`, the reference
 * implementation, is the oracle the specs hold it to on every fully known input.
 *
 * An unknown fact is `null` or absent. An expression over one is unknown unless
 * the known part already decides it (`false and ?` is false, `true or ?` is
 * true), and an unknown value carries the facts it waits for: exactly those a
 * question could still change (ticket 30).
 *
 * The subset is closed and typed, so the oracle and this file agree wherever
 * both answer: `and`, `or` and `!` take booleans, comparisons take two numbers
 * or two strings (an ISO date compares as text), arithmetic takes numbers, and
 * `in` looks in a list. Anything else is refused when the table is written and
 * thrown when it is run, never read as false.
 */

import type { FactType } from '@/lib/base-knowledge/wire/vocab'

export type Scalar = number | string | boolean
export type Value = Scalar | readonly Scalar[]

/** A value, or the facts it is still waiting for. */
export type Kleene = { known: true; value: Value } | { known: false; waitsFor: ReadonlySet<string> }

export type Facts = Readonly<Record<string, unknown>>

/** A condition or a fact the evaluator cannot run. A ruleset that throws this decides nothing. */
export class RulesetEvaluationError extends Error {
  override name = 'RulesetEvaluationError'
}

/** The operators of the subset with their arities: [min, max]. */
export const OPERATORS = {
  var: [1, 1],
  and: [1, 64],
  or: [1, 64],
  '!': [1, 1],
  '===': [2, 2],
  '!==': [2, 2],
  '<': [2, 3],
  '<=': [2, 3],
  '>': [2, 2],
  '>=': [2, 2],
  in: [2, 2],
  '+': [1, 64],
  '-': [1, 2],
  '*': [1, 64],
  '/': [2, 2],
  min: [1, 64],
  max: [1, 64],
  all: [2, 2],
  some: [2, 2],
  none: [2, 2],
} as const satisfies Record<string, readonly [number, number]>
export type Operator = keyof typeof OPERATORS

/** `""` names the current element inside `all`, `some` and `none`. */
const ELEMENT = ''

const known = (value: Value): Kleene => ({ known: true, value })
const waiting = (keys: Iterable<string>): Kleene => ({ known: false, waitsFor: new Set(keys) })

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function isOperator(name: string): name is Operator {
  return Object.hasOwn(OPERATORS, name)
}

/** JsonLogic lets a single argument go unwrapped (`{"!": x}`); the subset reads both. */
function argumentsOf(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [raw]
}

/** The one operator of a JsonLogic node, or null for a literal. */
function operation(expression: unknown): { op: string; args: unknown[] } | null {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression))
    return null
  const keys = Object.keys(expression)
  if (keys.length !== 1)
    throw new RulesetEvaluationError(`a JsonLogic node has one operator, found ${keys.length}`)
  const [op] = keys
  return { op, args: argumentsOf((expression as Record<string, unknown>)[op]) }
}

/**
 * What is wrong with a condition, as messages; empty when it is in the subset
 * and every `var` names a declared input (or the element, inside a list operator).
 */
export function checkExpression(
  expression: unknown,
  declared: ReadonlyMap<string, FactType>,
  inList = false
): string[] {
  if (isScalar(expression)) return []
  if (Array.isArray(expression)) {
    return expression.every(isScalar)
      ? []
      : ['a list literal holds numbers, strings or booleans only']
  }
  let node: ReturnType<typeof operation>
  try {
    node = operation(expression)
  } catch (error) {
    return [(error as Error).message]
  }
  if (!node) return [`${JSON.stringify(expression)} is not in the subset`]
  const { op, args } = node
  if (!isOperator(op)) return [`operator ${op} is not in the subset`]
  const [min, max] = OPERATORS[op]
  if (args.length < min || args.length > max)
    return [`${op} takes ${min} to ${max} arguments, found ${args.length}`]
  if (op === 'var') return checkVar(args[0], declared, inList)
  if (op === 'all' || op === 'some' || op === 'none') {
    return [
      ...checkExpression(args[0], declared, inList),
      ...checkExpression(args[1], declared, true),
    ]
  }
  return args.flatMap((arg) => checkExpression(arg, declared, inList))
}

function checkVar(
  name: unknown,
  declared: ReadonlyMap<string, FactType>,
  inList: boolean
): string[] {
  if (typeof name !== 'string') return ['var names one fact, with no default']
  if (name === ELEMENT) return inList ? [] : ['var "" is only the element inside all, some or none']
  return declared.has(name) ? [] : [`var ${name} is not a declared input`]
}

/** A fact as the evaluator reads it: its value, unknown, or a refusal when its type is not the declared one. */
export function readFact(key: string, type: FactType, raw: unknown): Kleene {
  if (raw === null || raw === undefined) return waiting([key])
  const fits =
    (type === 'number' && typeof raw === 'number' && Number.isFinite(raw)) ||
    (type === 'boolean' && typeof raw === 'boolean') ||
    (type === 'code' && typeof raw === 'string' && raw !== '') ||
    (type === 'date' && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ||
    (type === 'codes' && Array.isArray(raw) && raw.every((item) => typeof item === 'string'))
  if (!fits)
    throw new RulesetEvaluationError(`fact ${key} is not a ${type}: ${JSON.stringify(raw)}`)
  return known(raw as Value)
}

interface Scope {
  facts: ReadonlyMap<string, Kleene>
  element?: Value
}

/** The facts of a table's inputs, each read against its declared type. */
export function scopeOf(
  inputs: readonly { key: string; type: FactType }[],
  facts: Facts
): ReadonlyMap<string, Kleene> {
  return new Map(
    inputs.map((input) => [input.key, readFact(input.key, input.type, facts[input.key])])
  )
}

/** Evaluate one condition in three values. Throws {@link RulesetEvaluationError} outside the subset. */
export function evaluateExpression(
  expression: unknown,
  facts: ReadonlyMap<string, Kleene>
): Kleene {
  return evaluate(expression, { facts })
}

function evaluate(expression: unknown, scope: Scope): Kleene {
  if (isScalar(expression)) return known(expression)
  if (Array.isArray(expression)) {
    if (!expression.every(isScalar))
      throw new RulesetEvaluationError('a list literal holds scalars only')
    return known(expression)
  }
  const node = operation(expression)
  if (!node || !isOperator(node.op))
    throw new RulesetEvaluationError(`${JSON.stringify(expression)} is not in the subset`)
  const { op, args } = node
  const [min, max] = OPERATORS[op]
  if (args.length < min || args.length > max)
    throw new RulesetEvaluationError(`${op} takes ${min} to ${max} arguments`)
  if (op === 'var') return lookup(args[0], scope)
  if (op === 'all' || op === 'some' || op === 'none') return quantify(op, args, scope)
  const values = args.map((arg) => evaluate(arg, scope))
  if (op === 'and' || op === 'or') return connective(op, values)
  const pending = values.filter((value) => !value.known)
  if (pending.length > 0)
    return waiting(pending.flatMap((value) => (value.known ? [] : [...value.waitsFor])))
  return known(
    apply(
      op,
      values.map((value) => (value as { value: Value }).value)
    )
  )
}

function lookup(name: unknown, scope: Scope): Kleene {
  if (name === ELEMENT) {
    if (scope.element === undefined)
      throw new RulesetEvaluationError('var "" outside a list operator')
    return known(scope.element)
  }
  const fact = typeof name === 'string' ? scope.facts.get(name) : undefined
  if (!fact) throw new RulesetEvaluationError(`var ${String(name)} is not a declared input`)
  return fact
}

function asBoolean(value: Value, op: string): boolean {
  if (typeof value !== 'boolean')
    throw new RulesetEvaluationError(`${op} takes booleans, found ${JSON.stringify(value)}`)
  return value
}

/** Kleene's strong `and` / `or`: a deciding known operand wins over every unknown one. */
function connective(op: 'and' | 'or', values: readonly Kleene[]): Kleene {
  const decider = op === 'or'
  const waitsFor = new Set<string>()
  let decided = false
  for (const value of values) {
    if (!value.known) for (const key of value.waitsFor) waitsFor.add(key)
    else if (asBoolean(value.value, op) === decider) decided = true
  }
  if (decided) return known(decider)
  return waitsFor.size > 0 ? waiting(waitsFor) : known(!decider)
}

/** `all`, `some` and `none` over a list: `and`, `or` and `not or` of the predicate per element. */
function quantify(op: 'all' | 'some' | 'none', args: readonly unknown[], scope: Scope): Kleene {
  const list = evaluate(args[0], scope)
  if (!list.known) return list
  if (!Array.isArray(list.value)) throw new RulesetEvaluationError(`${op} takes a list`)
  const items = list.value as readonly Scalar[]
  // JsonLogic's own reading of the empty list: `all` of nothing is false.
  if (items.length === 0) return known(op === 'none')
  const each = items.map((element) => evaluate(args[1], { ...scope, element }))
  const any = connective(op === 'all' ? 'and' : 'or', each)
  if (op !== 'none' || !any.known) return any
  return known(!any.value)
}

function numbers(op: string, values: readonly Value[]): number[] {
  return values.map((value) => {
    if (typeof value !== 'number')
      throw new RulesetEvaluationError(`${op} takes numbers, found ${JSON.stringify(value)}`)
    return value
  })
}

/** Two numbers or two strings: what `<` compares the same way in JsonLogic and here. */
function comparable(op: string, values: readonly Value[]): readonly (number | string)[] {
  const kind = typeof values[0]
  if ((kind !== 'number' && kind !== 'string') || values.some((value) => typeof value !== kind)) {
    throw new RulesetEvaluationError(
      `${op} compares numbers with numbers or dates with dates, found ${JSON.stringify(values)}`
    )
  }
  return values as readonly (number | string)[]
}

function chain(
  values: readonly (number | string)[],
  holds: (a: number | string, b: number | string) => boolean
): boolean {
  return values.every((value, index) => index === 0 || holds(values[index - 1], value))
}

function apply(
  op: Exclude<Operator, 'var' | 'and' | 'or' | 'all' | 'some' | 'none'>,
  values: readonly Value[]
): Value {
  switch (op) {
    case '!':
      return !asBoolean(values[0], op)
    case '===':
    case '!==': {
      if (!values.every(isScalar)) throw new RulesetEvaluationError(`${op} compares scalars`)
      return (values[0] === values[1]) === (op === '===')
    }
    case '<':
      return chain(comparable(op, values), (a, b) => a < b)
    case '<=':
      return chain(comparable(op, values), (a, b) => a <= b)
    case '>':
      return chain(comparable(op, values), (a, b) => a > b)
    case '>=':
      return chain(comparable(op, values), (a, b) => a >= b)
    case 'in': {
      const [needle, haystack] = values
      if (!isScalar(needle) || !Array.isArray(haystack))
        throw new RulesetEvaluationError('in looks for a scalar in a list')
      return (haystack as readonly Scalar[]).includes(needle)
    }
    default:
      return arithmetic(op, numbers(op, values))
  }
}

function arithmetic(
  op: '+' | '-' | '*' | '/' | 'min' | 'max',
  operands: readonly number[]
): number {
  if (op === '/' && operands[1] === 0) throw new RulesetEvaluationError('division by zero')
  const result =
    op === '+'
      ? operands.reduce((sum, value) => sum + value, 0)
      : op === '-'
        ? operands.length === 1
          ? -operands[0]
          : operands[0] - operands[1]
        : op === '*'
          ? operands.reduce((product, value) => product * value, 1)
          : op === '/'
            ? operands[0] / operands[1]
            : op === 'min'
              ? Math.min(...operands)
              : Math.max(...operands)
  if (!Number.isFinite(result)) throw new RulesetEvaluationError(`${op} left the finite numbers`)
  return result
}
