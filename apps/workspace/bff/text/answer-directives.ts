import { closesCodeFence, openingCodeFence, type CodeFence } from './code-fence'
import {
  OUTCOME_FAIL,
  OUTCOME_PASS,
  figureOutcome,
  rowOutcome,
  statusColumnOf,
  valueAndLimit,
} from '@/shared/components/MarkdownRenderer/check-rows'
import { meetsLimit } from '@/shared/components/MarkdownRenderer/quantities'
import { valueText } from '@/shared/components/MarkdownRenderer/table-shape'

export const DIRECTIVE_BLOCKS = [
  'check',
  'procedure',
  'cases',
  'metrics',
  'compare',
  'details',
  'actions',
  'not-found',
  'subsumption',
] as const
export type DirectiveBlock = (typeof DIRECTIVE_BLOCKS)[number]

export const DIRECTIVE_MARKERS = {
  current: 'aktuell',
  applies: 'trifft zu',
  recommended: 'empfohlen',
} as const
export type DirectiveMarker = keyof typeof DIRECTIVE_MARKERS

export const PROJECT_DIRECTIVE = 'project'

export const PROJECT_KEYS = {
  building_class: 'building_class',
  escape_level_m: 'escape_level_m',
  use: 'uses',
  state: 'federal_state',
  storeys: 'storeys_above_ground',
  gross_floor_area_m2: 'gfa_above_ground',
} as const
export type ProjectKey = keyof typeof PROJECT_KEYS

export const isProjectKey = (key: string): key is ProjectKey =>
  Object.prototype.hasOwnProperty.call(PROJECT_KEYS, key)

export const ENERGY_CLASS_DIRECTIVE = 'energy-class'

export const ENERGY_CLASSES = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] as const

export function energyClass(label: string): (typeof ENERGY_CLASSES)[number] | null {
  const normal = label.replace(/\s+/g, '').toUpperCase()
  return (ENERGY_CLASSES as readonly string[]).includes(normal) ? (normal as (typeof ENERGY_CLASSES)[number]) : null
}

export const isDirectiveBlock = (name: string): name is DirectiveBlock =>
  (DIRECTIVE_BLOCKS as readonly string[]).includes(name)

export const isDirectiveMarker = (name: string): name is DirectiveMarker =>
  Object.prototype.hasOwnProperty.call(DIRECTIVE_MARKERS, name)

const OPENER = /^([ \t]*)(:{3,})[ \t]*([A-Za-z][\w-]*)(.*)$/
const CLOSER = /^([ \t]*)(:{3,})[ \t]*$/
const COLON_LINE = /^[ \t]*(:{3,})[ \t]*$/

export const MAX_DIRECTIVE_DEPTH = 4
export const MAX_DIRECTIVE_BLOCKS = 64

export type FenceEvent = 'open' | 'close' | 'code' | 'stray' | 'unwrapped' | null

export function scanDirectiveFences(lines: readonly string[]): FenceEvent[] {
  let fence: CodeFence | null = null
  const stack: boolean[] = []
  let opened = 0
  return lines.map((line): FenceEvent => {
    if (fence) {
      if (closesCodeFence(line, fence)) fence = null
      return 'code'
    }
    const codeFence = openingCodeFence(line)
    if (codeFence) {
      fence = codeFence
      return 'code'
    }
    if (OPENER.test(line)) {
      const kept = stack.filter((unwrapped) => !unwrapped).length
      const unwrapped = kept >= MAX_DIRECTIVE_DEPTH || opened >= MAX_DIRECTIVE_BLOCKS
      stack.push(unwrapped)
      if (unwrapped) return 'unwrapped'
      opened += 1
      return 'open'
    }
    if (CLOSER.test(line)) {
      if (stack.length === 0) return 'stray'
      return stack.pop() ? 'unwrapped' : 'close'
    }
    return null
  })
}

export function directiveDepths(lines: readonly string[]): number[] {
  let depth = 0
  return scanDirectiveFences(lines).map((event) => {
    const before = depth
    if (event === 'open') depth += 1
    else if (event === 'close') depth -= 1
    return before
  })
}

interface OpenContainer {
  line: number
  colons: number
}

function canonicalOpener(line: string, colons: string): string {
  return line.replace(OPENER, (_m, indent: string, _c, name: string, rest: string) => {
    const trimmed = rest.trim()
    const words = trimmed && !/^[[{]/.test(trimmed) && /^\s/.test(rest) ? `[${trimmed.replace(/[[\]]/g, '')}]` : rest
    return `${indent}${colons}${name}${words}`
  })
}

export function normalizeDirectiveFences(markdown: string): string {
  if (!markdown.includes(':::')) return markdown
  const lines = markdown.split('\n')
  const stack: OpenContainer[] = []
  const pairs: { open: number; close: number | null; colons: number }[] = []
  const dropped: number[] = []
  const events = scanDirectiveFences(lines)
  events.forEach((event, index) => {
    if (event === 'open') {
      stack.push({ line: index, colons: 3 })
      return
    }
    if (event === 'stray' || event === 'unwrapped') {
      dropped.push(index)
      return
    }
    if (event === 'code') {
      const run = COLON_LINE.exec(lines[index])
      const inner = stack[stack.length - 1]
      if (run && inner) inner.colons = Math.max(inner.colons, run[1].length + 1)
      return
    }
    if (event !== 'close') return
    const closed = stack.pop() as OpenContainer
    pairs.push({ open: closed.line, close: index, colons: closed.colons })
    const parent = stack[stack.length - 1]
    if (parent) parent.colons = Math.max(parent.colons, closed.colons + 1)
  })
  for (let at = stack.length - 1; at >= 0; at--) {
    const open = stack[at]
    pairs.push({ open: open.line, close: null, colons: open.colons })
    const parent = stack[at - 1]
    if (parent) parent.colons = Math.max(parent.colons, open.colons + 1)
  }
  let changed = dropped.length > 0
  for (const { open, close, colons } of pairs) {
    const fence = ':'.repeat(colons)
    const opener = canonicalOpener(lines[open], fence)
    const closer = close === null ? null : lines[close].replace(CLOSER, (_m, indent: string) => `${indent}${fence}`)
    if (opener !== lines[open] || (close !== null && closer !== lines[close])) changed = true
    lines[open] = opener
    if (close !== null && closer !== null) lines[close] = closer
  }
  if (!changed) return markdown
  for (const index of dropped) lines[index] = ''
  return lines.join('\n')
}

const openerLabel = (rest: string): string => {
  const trimmed = rest.trim()
  const match = /^\[([^\]]*)\]/.exec(trimmed)
  if (match) return match[1].trim()
  return trimmed && !trimmed.startsWith('{') && /^\s/.test(rest) ? trimmed : ''
}

const TEXT_DIRECTIVE = /(^|[^\w:\\])(:)([A-Za-z][\w-]{0,63})(?:\[([^\]\n]{0,200})\])?(?:\{[^}\n]{0,200}\})?/g

export function casesBy(attributes: string): ProjectKey | null {
  const match = /(?:^|[\s{])by=["']?([A-Za-z][\w-]*)/.exec(attributes)
  return match && isProjectKey(match[1]) ? match[1] : null
}

export function projectKeysIn(markdown: string): ProjectKey[] {
  if (!markdown.includes(':')) return []
  const found: ProjectKey[] = []
  const add = (key: string | null) => {
    if (key && isProjectKey(key) && !found.includes(key)) found.push(key)
  }
  let fence: CodeFence | null = null
  for (const line of markdown.split('\n')) {
    if (fence) {
      if (closesCodeFence(line, fence)) fence = null
      continue
    }
    fence = openingCodeFence(line)
    if (fence) continue
    const opener = OPENER.exec(line)
    if (opener) {
      if (opener[3] === 'cases') add(casesBy(opener[4]))
      continue
    }
    for (const [index, part] of line.split(/(`[^`]*`)/).entries()) {
      if (index % 2 === 1) continue
      for (const match of part.matchAll(TEXT_DIRECTIVE)) {
        if (match[3] === PROJECT_DIRECTIVE && match[4] !== undefined) add(match[4].trim())
      }
    }
  }
  return found
}

export interface StripOptions {
  projectValue?: (key: ProjectKey) => string | null
  outcomeWords?: OutcomeWords
}

export interface OutcomeWords {
  pass: string
  fail: string
  conflict: string
}

const GERMAN_OUTCOMES: OutcomeWords = { pass: 'erfüllt', fail: 'nicht erfüllt', conflict: 'Widerspruch – prüfen' }

function rowCells(line: string): { indent: string; cells: string[] } | null {
  const match = /^([ \t]*)\|(.*)$/.exec(line)
  if (!match) return null
  const cells = match[2].split(/(?<!\\)\|/)
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  return { indent: match[1], cells: cells.map((cell) => cell.trim()) }
}

const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/

function reconcileTable(lines: string[], block: 'check' | 'metrics', words: OutcomeWords): string[] {
  const parsed = lines.map(rowCells)
  if (parsed.length < 3 || parsed.some((row) => row === null) || !DELIMITER_ROW.test(lines[1])) return lines
  const body = (parsed.slice(2) as { indent: string; cells: string[] }[]).map((row) => ({
    ...row,
    texts: row.cells.map((cell) => valueText(cell)),
  }))
  const statusColumn = block === 'check' ? statusColumnOf(body.map((row) => row.texts), (parsed[0] as { cells: string[] }).cells.length) : -1
  const printed = (word: string, written: string) =>
    word === OUTCOME_PASS ? words.pass : word === OUTCOME_FAIL ? words.fail : `${words.conflict} (${written})`
  return [
    lines[0],
    lines[1],
    ...body.map((row, index) => {
      const line = lines[index + 2]
      let at = statusColumn
      let outcome: ReturnType<typeof rowOutcome> = null
      if (block === 'check') {
        if (at < 0) return line
        const measure = valueAndLimit(row.texts)
        const computed = measure ? meetsLimit(measure.quantity, measure.limit.limit) : null
        outcome = rowOutcome(row.texts[at] ?? '', computed)
      } else {
        const figure = figureOutcome(row.texts)
        at = figure.statusAt
        outcome = figure.outcome
      }
      if (at < 0 || !outcome?.replaced) return line
      const cells = [...row.cells]
      const citation = cells[at].slice(valueText(cells[at]).length)
      cells[at] = `${printed(outcome.word, row.texts[at])}${citation}`
      return `${row.indent}| ${cells.join(' | ')} |`
    }),
  ]
}

export function stripDirectives(markdown: string, options: StripOptions = {}): string {
  if (!markdown.includes(':')) return markdown
  const words = options.outcomeWords ?? GERMAN_OUTCOMES
  let fence: CodeFence | null = null
  const out: string[] = []
  const open: string[] = []
  let table: string[] = []
  let tableBlock: 'check' | 'metrics' | null = null
  const flush = () => {
    if (table.length > 0 && tableBlock) out.push(...reconcileTable(table, tableBlock, words).map((line) => stripTextDirectives(line, options)))
    table = []
    tableBlock = null
  }
  for (const line of markdown.split('\n')) {
    const inner = open[open.length - 1]
    if (!fence && (inner === 'check' || inner === 'metrics') && /^[ \t]*\|/.test(line)) {
      tableBlock = inner
      table.push(line)
      continue
    }
    flush()
    if (fence) {
      if (closesCodeFence(line, fence)) fence = null
      out.push(line)
      continue
    }
    fence = openingCodeFence(line)
    if (fence) {
      out.push(line)
      continue
    }
    const opener = OPENER.exec(line)
    if (opener) {
      open.push(opener[3])
      const label = openerLabel(opener[4])
      if (label) out.push(`${opener[1]}**${label}**`, '')
      continue
    }
    if (CLOSER.test(line)) {
      open.pop()
      continue
    }
    out.push(stripTextDirectives(line, options))
  }
  flush()
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

function stripTextDirectives(line: string, options: StripOptions): string {
  if (!line.includes(':')) return line
  return line
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(TEXT_DIRECTIVE, (whole, before: string, _colon, name: string, label?: string) => {
            if (name === ENERGY_CLASS_DIRECTIVE && label !== undefined && energyClass(label)) return `${before}${energyClass(label)}`
            if (isDirectiveMarker(name) && label === undefined) return `${before}(${DIRECTIVE_MARKERS[name]})`
            if (name === PROJECT_DIRECTIVE && label !== undefined) {
              const key = label.trim()
              return `${before}${(isProjectKey(key) && options.projectValue?.(key)) || key}`
            }
            return whole
          })
    )
    .join('')
}
