import type { FactType } from '@/lib/base-knowledge/wire/vocab'

export type Scalar = number | string | boolean
export type Value = Scalar | readonly Scalar[]

export type Kleene = { known: true; value: Value } | { known: false; waitsFor: ReadonlySet<string> }

export type Facts = Readonly<Record<string, unknown>>

export class RulesetEvaluationError extends Error {
  override name = 'RulesetEvaluationError'
}

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

export const MAX_DEPTH = 32

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

function argumentsOf(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [raw]
}

function operation(expression: unknown): { op: string; args: unknown[] } | null {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression))
    return null
  const keys = Object.keys(expression)
  if (keys.length !== 1)
    throw new RulesetEvaluationError(`a JsonLogic node has one operator, found ${keys.length}`)
  const [op] = keys
  return { op, args: argumentsOf((expression as Record<string, unknown>)[op]) }
}

type StaticType = 'boolean' | 'number' | 'string' | 'list' | 'scalar'

const STATIC_TYPE_OF_FACT: Record<FactType, StaticType> = {
  number: 'number',
  boolean: 'boolean',
  code: 'string',
  date: 'string',
  codes: 'list',
}

interface Checked {
  type: StaticType | null
  problems: string[]
}

const problem = (message: string): Checked => ({ type: null, problems: [message] })

export function checkExpression(
  expression: unknown,
  declared: ReadonlyMap<string, FactType>
): string[] {
  const checked = typeOf(expression, declared, null)
  if (checked.problems.length > 0) return checked.problems
  return checked.type === 'boolean' ? [] : [`a condition is a boolean, found ${checked.type}`]
}

function typeOf(
  expression: unknown,
  declared: ReadonlyMap<string, FactType>,
  element: StaticType | null,
  depth = 0
): Checked {
  if (depth > MAX_DEPTH) return problem(`a condition nests at most ${MAX_DEPTH} levels`)
  if (typeof expression === 'boolean') return { type: 'boolean', problems: [] }
  if (typeof expression === 'string') return { type: 'string', problems: [] }
  if (typeof expression === 'number')
    return Number.isFinite(expression)
      ? { type: 'number', problems: [] }
      : problem('a number is finite')
  if (Array.isArray(expression)) {
    return expression.every(isScalar)
      ? { type: 'list', problems: [] }
      : problem('a list literal holds numbers, strings or booleans only')
  }
  let node: ReturnType<typeof operation>
  try {
    node = operation(expression)
  } catch (error) {
    return problem((error as Error).message)
  }
  if (!node) return problem(`${JSON.stringify(expression)} is not in the subset`)
  const { op, args } = node
  if (!isOperator(op)) return problem(`operator ${op} is not in the subset`)
  const [min, max] = OPERATORS[op]
  if (args.length < min || args.length > max)
    return problem(`${op} takes ${min} to ${max} arguments, found ${args.length}`)
  if (op === 'var') return typeOfVar(args[0], declared, element)
  if (op === 'all' || op === 'some' || op === 'none') {
    const list = typeOf(args[0], declared, element, depth + 1)
    const predicate = typeOf(args[1], declared, 'scalar', depth + 1)
    return expecting(op, [list, predicate], ['list', 'boolean'], 'boolean')
  }
  const operands = args.map((arg) => typeOf(arg, declared, element, depth + 1))
  return typeOfOperation(op, operands)
}

function typeOfVar(
  name: unknown,
  declared: ReadonlyMap<string, FactType>,
  element: StaticType | null
): Checked {
  if (typeof name !== 'string') return problem('var names one fact, with no default')
  if (name === ELEMENT)
    return element
      ? { type: element, problems: [] }
      : problem('var "" is only the element inside all, some or none')
  if (element) return problem(`inside all, some or none only the element is read, not ${name}`)
  const type = declared.get(name)
  return type
    ? { type: STATIC_TYPE_OF_FACT[type], problems: [] }
    : problem(`var ${name} is not a declared input`)
}

function expecting(
  op: string,
  operands: readonly Checked[],
  expected: readonly StaticType[],
  result: StaticType
): Checked {
  const problems = operands.flatMap((operand) => operand.problems)
  if (problems.length > 0) return { type: null, problems }
  const fits = (actual: StaticType | null, wanted: StaticType) =>
    actual === wanted ||
    (wanted === 'scalar' &&
      (actual === 'number' || actual === 'string' || actual === 'boolean' || actual === 'scalar'))
  const wrong = operands.findIndex((operand, index) => !fits(operand.type, expected[index]))
  if (wrong >= 0)
    return problem(
      `${op} takes ${expected[wrong]} as operand ${wrong + 1}, found ${operands[wrong].type}`
    )
  return { type: result, problems: [] }
}

function typeOfOperation(
  op: Exclude<Operator, 'var' | 'all' | 'some' | 'none'>,
  operands: readonly Checked[]
): Checked {
  const all = (type: StaticType) => operands.map(() => type)
  switch (op) {
    case 'and':
    case 'or':
    case '!':
      return expecting(op, operands, all('boolean'), 'boolean')
    case '===':
    case '!==':
      return expecting(op, operands, all('scalar'), 'boolean')
    case 'in':
      return expecting(op, operands, ['scalar', 'list'], 'boolean')
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const first = operands[0]?.type
      return expecting(op, operands, all(first === 'string' ? 'string' : 'number'), 'boolean')
    }
    default:
      return expecting(op, operands, all('number'), 'number')
  }
}

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
  depth: number
}

export function scopeOf(
  inputs: readonly { key: string; type: FactType }[],
  facts: Facts
): ReadonlyMap<string, Kleene> {
  return new Map(
    inputs.map((input) => [
      input.key,
      readFact(
        input.key,
        input.type,
        Object.hasOwn(facts, input.key) ? facts[input.key] : undefined
      ),
    ])
  )
}

export function evaluateExpression(
  expression: unknown,
  facts: ReadonlyMap<string, Kleene>
): Kleene {
  return evaluate(expression, { facts, depth: 0 })
}

function evaluate(expression: unknown, scope: Scope): Kleene {
  if (scope.depth > MAX_DEPTH)
    throw new RulesetEvaluationError(`a condition nests at most ${MAX_DEPTH} levels`)
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
  const values = args.map((arg) => evaluate(arg, deeper(scope)))
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

const deeper = (scope: Scope): Scope => ({ ...scope, depth: scope.depth + 1 })

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

function quantify(op: 'all' | 'some' | 'none', args: readonly unknown[], scope: Scope): Kleene {
  const list = evaluate(args[0], deeper(scope))
  if (!list.known) return list
  if (!Array.isArray(list.value)) throw new RulesetEvaluationError(`${op} takes a list`)
  const items = list.value as readonly Scalar[]
  if (items.length === 0) return known(op === 'none')
  const each = items.map((element) => evaluate(args[1], { ...deeper(scope), element }))
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
