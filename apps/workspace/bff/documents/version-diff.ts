import { diffLines } from 'diff'

export const DIFF_CONTEXT_LINES = 3

export const DIFF_MAX_ROWS = 2000

export type DiffRowKind = 'context' | 'added' | 'removed'

export interface DiffTextRow {
  kind: DiffRowKind
  text: string
  fromLine: number | null
  toLine: number | null
}

export interface DiffGapRow {
  kind: 'gap'
  skipped: number
}

export type DiffRow = DiffTextRow | DiffGapRow

export interface VersionDiff {
  rows: DiffRow[]
  added: number
  removed: number
  identical: boolean
  truncated: boolean
}

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n')

function chunkLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function alignRows(from: string, to: string): { rows: DiffTextRow[]; added: number; removed: number } {
  const rows: DiffTextRow[] = []
  let fromLine = 0
  let toLine = 0
  let added = 0
  let removed = 0

  for (const change of diffLines(from, to)) {
    for (const text of chunkLines(change.value)) {
      if (change.added) {
        toLine += 1
        added += 1
        rows.push({ kind: 'added', text, fromLine: null, toLine })
        continue
      }
      if (change.removed) {
        fromLine += 1
        removed += 1
        rows.push({ kind: 'removed', text, fromLine, toLine: null })
        continue
      }
      fromLine += 1
      toLine += 1
      rows.push({ kind: 'context', text, fromLine, toLine })
    }
  }

  return { rows, added, removed }
}

function keptIndexes(rows: readonly DiffTextRow[]): Set<number> {
  const kept = new Set<number>()
  rows.forEach((row, index) => {
    if (row.kind === 'context') return
    const first = Math.max(0, index - DIFF_CONTEXT_LINES)
    const last = Math.min(rows.length - 1, index + DIFF_CONTEXT_LINES)
    for (let i = first; i <= last; i++) kept.add(i)
  })
  return kept
}

function fold(rows: readonly DiffTextRow[]): DiffRow[] {
  const kept = keptIndexes(rows)
  const folded: DiffRow[] = []
  let skipped = 0

  const flush = (): void => {
    if (skipped === 0) return
    folded.push({ kind: 'gap', skipped })
    skipped = 0
  }

  rows.forEach((row, index) => {
    if (!kept.has(index)) {
      skipped += 1
      return
    }
    flush()
    folded.push(row)
  })
  flush()
  return folded
}

export function diffVersionText(from: string, to: string): VersionDiff {
  const left = normalizeNewlines(from)
  const right = normalizeNewlines(to)
  if (left === right) {
    return { rows: [], added: 0, removed: 0, identical: true, truncated: false }
  }

  const aligned = alignRows(left, right)
  const folded = fold(aligned.rows)
  const truncated = folded.length > DIFF_MAX_ROWS
  return {
    rows: truncated ? folded.slice(0, DIFF_MAX_ROWS) : folded,
    added: aligned.added,
    removed: aligned.removed,
    identical: false,
    truncated,
  }
}
