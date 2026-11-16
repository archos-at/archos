import { useState } from 'react'
import type { DocumentEvidence, IntakeView, Suggestion } from '@/lib/project-intake/types'
import { documentValues } from './reading-milestones'

export interface FoundValue {
  key: string
  label: string
  display: string
  source: { fileName: string; name: string; page: number | null }
  fresh: boolean
}

export function documentName(fileName: string): string {
  const stripped = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  return stripped.length > 0 ? stripped : fileName
}

function sourceOf(item: Suggestion): FoundValue['source'] | null {
  const evidence = item.evidence.find((entry): entry is DocumentEvidence => entry.kind === 'document')
  if (!evidence) return null
  return { fileName: evidence.fileName, name: documentName(evidence.fileName), page: evidence.page }
}

export function foundValues(view: IntakeView, arrival: ReadonlyMap<string, number>, limit = 3): FoundValue[] {
  const ranked = documentValues(view).map((item, index) => ({ item, index, seen: arrival.get(item.key) ?? 0 }))
  ranked.sort(
    (a, b) => b.seen - a.seen || Number(b.item.decisive) - Number(a.item.decisive) || a.index - b.index
  )
  return ranked.slice(0, limit).flatMap(({ item, seen }) => {
    const source = sourceOf(item)
    if (!source) return []
    return [{ key: item.key, label: item.label, display: item.display, source, fresh: seen > 0 }]
  })
}

interface Arrivals {
  signature: string
  arrival: ReadonlyMap<string, number>
  tick: number
}

export function useArrivalOrder(keys: readonly string[]): ReadonlyMap<string, number> {
  const signature = keys.join('\n')
  const [state, setState] = useState<Arrivals>(() => ({
    signature,
    arrival: new Map(keys.map((key) => [key, 0])),
    tick: 0,
  }))
  if (state.signature === signature) return state.arrival
  const fresh = keys.filter((key) => !state.arrival.has(key))
  const tick = fresh.length > 0 ? state.tick + 1 : state.tick
  const arrival = new Map(state.arrival)
  for (const key of fresh) arrival.set(key, tick)
  setState({ signature, arrival, tick })
  return arrival
}
