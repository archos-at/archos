import type { WireEvent } from '@/adapters/api/wire-v2'

export const groupByTurn = (events: readonly WireEvent[]): Map<string, WireEvent[]> => {
  const byTurn = new Map<string, WireEvent[]>()
  for (const event of events) {
    const list = byTurn.get(event.turn_id)
    if (list) list.push(event)
    else byTurn.set(event.turn_id, [event])
  }
  return byTurn
}
