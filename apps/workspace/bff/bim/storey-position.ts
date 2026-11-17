import type { BimRuleFacts } from './rule-types'

export type BimStoreyPosition = 'top' | 'above' | 'below'

export const STOREY_LABEL: Record<BimStoreyPosition, string> = {
  top: 'oberstes Geschoß',
  above: 'oberirdisches Geschoß',
  below: 'Kellergeschoß',
}

export function classifyStorey(
  storeyName: string | null,
  storeys: BimRuleFacts['storeys']
): BimStoreyPosition | null {
  if (!storeyName || !storeys || storeys.length === 0) return null
  const known = storeys.filter((entry) => typeof entry.elevation === 'number')
  const match = known.find((entry) => entry.name === storeyName)
  if (!match || typeof match.elevation !== 'number') return null
  if (match.elevation < 0) return 'below'
  const highest = Math.max(...known.map((entry) => entry.elevation as number))
  if (match.elevation !== highest) return 'above'
  const atHighest = known.filter((entry) => entry.elevation === highest).length
  return atHighest === 1 ? 'top' : null
}
