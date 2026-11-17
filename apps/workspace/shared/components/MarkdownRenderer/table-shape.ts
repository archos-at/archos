import type { Element, ElementContent, Root, RootContent } from 'hast'

import { isPlaceholder, parseLimit, parseQuantity } from './quantities'
import { isActiveStatus, statusTone } from './status-marks'

const SOURCE_HEADERS = new Set(['fundstelle', 'quelle', 'grundlage', 'source', 'reference', 'references'])
const STATUS_HEADERS = new Set(['status', 'erfüllt', 'ergebnis', 'bewertung', 'result'])

export const isElement = (node: RootContent | ElementContent | Root): node is Element =>
  (node as Element).type === 'element'

export const elements = (node: Element | Root, tag: string): Element[] =>
  (node.children as (RootContent | ElementContent)[]).filter(
    (child): child is Element => isElement(child) && child.tagName === tag
  )

export function textOf(node: ElementContent | RootContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

export const cellText = (cell: Element) => textOf(cell).trim().replace(/\s+/g, ' ')

const MATH_CLASSES = new Set(['katex', 'katex-display'])
const isMath = (node: Element): boolean => {
  const classes = node.properties?.className
  return Array.isArray(classes) && classes.some((name) => MATH_CLASSES.has(String(name)))
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

export function visibleText(node: ElementContent | RootContent): string {
  const raw = (function walk(current: ElementContent | RootContent): string {
    if (current.type === 'text') return current.value
    if (current.type !== 'element' || isMath(current)) return ''
    return current.children.map(walk).join('')
  })(node)
  return raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
}

export const capText = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
const key = (text: string) => text.toLocaleLowerCase('de')

export interface Row {
  row: Element
  cells: Element[]
}

export const cellsOf = (row: Element) =>
  (row.children as ElementContent[]).filter(
    (child): child is Element => isElement(child) && (child.tagName === 'td' || child.tagName === 'th')
  )

export function tableParts(table: Element): { head: Row; rows: Row[] } | null {
  const thead = elements(table, 'thead')[0]
  const tbody = elements(table, 'tbody')[0]
  const headRow = thead && elements(thead, 'tr')[0]
  if (!headRow || !tbody) return null
  return {
    head: { row: headRow, cells: cellsOf(headRow) },
    rows: elements(tbody, 'tr').map((row) => ({ row, cells: cellsOf(row) })),
  }
}

export const columnCells = (rows: Row[], column: number): Element[] | null => {
  const cells = rows.map((row) => row.cells[column])
  return cells.every(Boolean) ? cells : null
}

function liftSharedSource(table: Element, column: number, head: Row, rows: Row[], text: (cell: Element) => string): boolean {
  if (column < 0 || rows.length < 2 || head.cells.length < 3) return false
  const cells = columnCells(rows, column)
  if (!cells) return false
  const first = text(cells[0])
  if (!first || cells.some((cell) => text(cell) !== first)) return false
  for (const { row, cells: rowCells } of [head, ...rows]) {
    const cell = rowCells[column]
    row.children = row.children.filter((child) => child !== cell)
  }
  table.children.push({
    type: 'element',
    tagName: 'caption',
    properties: { dataLabel: text(head.cells[column]) },
    children: cells[0].children,
  })
  return true
}

const CITATION = /^\[(\d+)\]$/

function lastCitation(value: string): { number: string; start: number } | null {
  if (!value.endsWith(']')) return null
  let open = value.length - 1
  while (open > 0 && value[open - 1] >= '0' && value[open - 1] <= '9') open--
  if (open === value.length - 1 || value[open - 1] !== '[') return null
  return { number: value.slice(open, -1), start: open - 1 }
}

function withoutTrailingCitations(value: string, cited: Set<string>): string {
  const trimmed = value.trimEnd()
  let rest = trimmed
  for (let citation = lastCitation(rest); citation; citation = lastCitation(rest)) {
    if (!cited.has(citation.number)) return trimmed
    rest = rest.slice(0, citation.start).trimEnd()
  }
  return rest
}

const citationsIn = (cell: Element): Set<string> =>
  new Set([...textOf(cell).matchAll(/\[(\d+)\]/g)].map((match) => match[1]))

function dropTrailingCitations(cell: Element, cited: Set<string>): void {
  const children = (cell.children as ElementContent[]).map((child) => (child.type === 'text' ? { ...child } : child))
  for (;;) {
    const last = children[children.length - 1]
    if (!last) break
    if (last.type === 'text') {
      const value = withoutTrailingCitations(last.value, cited)
      if (value === last.value) break
      last.value = value
      if (!last.value) children.pop()
      continue
    }
    const marker = isElement(last) ? textOf(last).trim().match(CITATION) : null
    if (!marker || !cited.has(marker[1])) break
    children.pop()
  }
  if (children.map(textOf).join('').trim()) cell.children = children
}

function dropRepeatedCitations(column: number, rows: Row[]): void {
  if (column < 0) return
  for (const { cells } of rows) {
    const source = cells[column]
    if (!source) continue
    const cited = citationsIn(source)
    if (cited.size === 0) continue
    cells.forEach((cell, index) => {
      if (index !== column) dropTrailingCitations(cell, cited)
    })
  }
}

export const valueText = (text: string): string => {
  let rest = text.trimEnd()
  for (let citation = lastCitation(rest); citation; citation = lastCitation(rest)) {
    rest = rest.slice(0, citation.start).trimEnd()
  }
  return rest.trim()
}

function markActiveRows(rows: Row[], column: number, text: (cell: Element) => string): void {
  for (const { row, cells } of rows) {
    const cell = cells[column]
    if (cell && isActiveStatus(text(cell))) row.properties = { ...row.properties, dataActive: 'true' }
  }
}

function markNumericColumns(head: Row, rows: Row[], text: (cell: Element) => string, judged: Row[] = rows): void {
  head.cells.forEach((headCell, column) => {
    const cells = columnCells(judged, column)
    if (!cells || cells.length === 0) return
    let values = 0
    for (const cell of cells) {
      const value = valueText(text(cell))
      if (isPlaceholder(value)) continue
      if (!parseQuantity(value) && !parseLimit(value)) return
      values += 1
    }
    if (values === 0) return
    const marked = judged === rows ? cells : rows.flatMap((row) => row.cells[column] ?? [])
    for (const cell of [headCell, ...marked]) cell.properties = { ...cell.properties, dataNumeric: 'true' }
  })
}

const PROSE_CELL_CHARS = 140
const LONG_LABEL_CHARS = 16

export function statusTally(cells: Element[] | null, text: (cell: Element) => string): string | null {
  if (!cells || cells.length < 3) return null
  const counts = new Map<string, { word: string; count: number }>()
  for (const cell of cells) {
    const word = text(cell)
    if (!statusTone(word)) return null
    const entry = counts.get(key(word)) ?? { word, count: 0 }
    entry.count += 1
    counts.set(key(word), entry)
  }
  return counts.size > 0 ? [...counts.values()].map(({ word, count }) => `${word}:${count}`).join(',') : null
}

export function markStatusCells(cells: Element[], text: (cell: Element) => string): void {
  for (const cell of cells) {
    const tone = statusTone(text(cell))
    if (tone) cell.properties = { ...cell.properties, dataStatus: tone }
  }
}

function shapeTable(table: Element, open: boolean): void {
  const parts = tableParts(table)
  if (!parts) {
    stackHeaderOnly(table, open)
    return
  }
  const { head, rows } = parts
  const complete = open ? rows.slice(0, -1) : rows
  const columnOf = (headers: ReadonlySet<string>) => head.cells.findIndex((cell) => headers.has(key(cellText(cell))))
  const sourceColumn = columnOf(SOURCE_HEADERS)
  dropRepeatedCitations(sourceColumn, rows)
  const texts = new Map<Element, string>()
  const text = (cell: Element) => {
    let value = texts.get(cell)
    if (value === undefined) texts.set(cell, (value = cellText(cell)))
    return value
  }
  const statusColumn = columnOf(STATUS_HEADERS)
  if (statusColumn >= 0) {
    const held = rows
      .slice(0, -1)
      .every(({ cells }) => cells[statusColumn] !== undefined && statusTone(text(cells[statusColumn])))
    const tally = open ? null : statusTally(columnCells(rows, statusColumn), text)
    if (tally) table.properties = { ...table.properties, dataTally: tally }
    else if (held) table.properties = { ...table.properties, dataTallyReserve: open ? 'true' : 'closed' }
    markStatusCells(rows.flatMap((row) => row.cells[statusColumn] ?? []), text)
    markActiveRows(rows, statusColumn, text)
  }
  const lifted = !open && liftSharedSource(table, sourceColumn, head, rows, text) ? sourceColumn : -1
  markNumericColumns(head, rows, text, complete)
  const kept = <T>(items: T[]) => items.filter((_, index) => index !== lifted)
  const labels = kept(head.cells).map(text)
  const prose = rows.some((row) => row.cells.some((cell) => text(cell).length > PROSE_CELL_CHARS))
  if (labels.length >= 2 && prose) table.properties = { ...table.properties, dataStack: 'always' }
  else if (labels.length >= 3) table.properties = { ...table.properties, dataStack: 'true' }
  if (labels.slice(1).some((label) => label.length > LONG_LABEL_CHARS)) {
    table.properties = { ...table.properties, dataLabels: 'above' }
  }
  for (const row of rows) {
    kept(row.cells).forEach((cell, index) => {
      cell.properties = { ...cell.properties, dataLabel: labels[index] ?? '' }
    })
  }
}

function stackHeaderOnly(table: Element, open: boolean): void {
  const thead = elements(table, 'thead')[0]
  const headRow = thead && elements(thead, 'tr')[0]
  if (!headRow) return
  const headers = cellsOf(headRow)
  if (headers.length >= 3) table.properties = { ...table.properties, dataStack: 'true' }
  if (open && headers.some((cell) => STATUS_HEADERS.has(key(cellText(cell))))) {
    table.properties = { ...table.properties, dataTallyReserve: 'true' }
  }
}

function visitTables(node: Root | Element, open: Element | null): void {
  for (const child of node.children) {
    if (!isElement(child)) continue
    if (child.tagName === 'table') shapeTable(child, child === open)
    else visitTables(child, open)
  }
}

export function tailTableIn(node: Element | Root): Element | null {
  let current: Element | Root = node
  for (;;) {
    const children = current.children as (RootContent | ElementContent)[]
    let last: RootContent | ElementContent | undefined
    for (let index = children.length - 1; index >= 0 && !last; index--) {
      const child = children[index]
      if (!(child.type === 'text' && child.value.trim() === '') && child.type !== 'comment') last = child
    }
    if (!last || !isElement(last)) return null
    if (last.tagName === 'table') return last
    current = last
  }
}

export interface TableShapeOptions {
  openTail?: boolean
}

export function rehypeTableShape(options: TableShapeOptions = {}) {
  return (tree: Root) => visitTables(tree, options.openTail === true ? tailTableIn(tree) : null)
}

export function parseTally(tally: unknown): [string, number][] {
  if (typeof tally !== 'string' || !tally) return []
  return tally.split(',').flatMap((entry) => {
    const at = entry.lastIndexOf(':')
    const count = Number(entry.slice(at + 1))
    return at > 0 && Number.isFinite(count) ? [[entry.slice(0, at), count] as [string, number]] : []
  })
}
