'use client'

import { useCallback, useState } from 'react'
import { ROUND_GROUPS, type RoundEntry, type RoundGroup } from '../../lib/question-round'

export interface RoundRow {
  id: string
  group: RoundGroup
  label: string
  done: boolean
  value?: string
  entry?: RoundEntry
}

interface Seen {
  group: RoundGroup
  label: string
}

export function useRoundMemory(
  entries: readonly RoundEntry[],
  settled: readonly RoundEntry[],
  labelOf: (entry: RoundEntry) => string
): { rows: RoundRow[]; markDone: (id: string, value: string) => void } {
  const [seen, setSeen] = useState<ReadonlyMap<string, Seen>>(() => remember(new Map(), [...entries, ...settled], labelOf))
  const [given, setGiven] = useState<ReadonlyMap<string, string>>(() => new Map())
  const unseen = [...entries, ...settled].filter((entry) => !seen.has(entry.id))
  if (unseen.length > 0) setSeen(remember(seen, unseen, labelOf))
  const open = new Map(entries.map((entry) => [entry.id, entry]))
  const all = new Map(seen)
  for (const entry of unseen) all.set(entry.id, { group: entry.group, label: labelOf(entry) })
  const rows: RoundRow[] = []
  for (const group of ROUND_GROUPS) {
    for (const [id, item] of all) {
      if (item.group !== group) continue
      const value = given.get(id)
      const entry = open.get(id)
      const done = value !== undefined || entry === undefined
      rows.push({ id, group, label: item.label, done, ...(value === undefined ? {} : { value }), ...(done ? {} : { entry }) })
    }
  }
  const markDone = useCallback((id: string, value: string) => {
    setGiven((previous) => new Map(previous).set(id, value))
  }, [])
  return { rows, markDone }
}

function remember(
  seen: ReadonlyMap<string, Seen>,
  entries: readonly RoundEntry[],
  labelOf: (entry: RoundEntry) => string
): ReadonlyMap<string, Seen> {
  const next = new Map(seen)
  for (const entry of entries) if (!next.has(entry.id)) next.set(entry.id, { group: entry.group, label: labelOf(entry) })
  return next
}

export function nextOpenRow(rows: readonly RoundRow[], afterId: string | null, skipped: ReadonlySet<string>): RoundRow | null {
  const start = afterId === null ? -1 : rows.findIndex((row) => row.id === afterId)
  const ordered = [...rows.slice(start + 1), ...rows.slice(0, start + 1)]
  return ordered.find((row) => !row.done && !skipped.has(row.id)) ?? ordered.find((row) => !row.done) ?? null
}

export function currentRow(rows: readonly RoundRow[], chosenId: string | null, skipped: ReadonlySet<string>): RoundRow | null {
  const chosen = rows.find((row) => row.id === chosenId)
  if (chosen && !chosen.done) return chosen
  return nextOpenRow(rows, chosenId, skipped)
}
