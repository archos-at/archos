import type { BimModelSummary } from './types'

export type BimSuggestionConfidence = 'low' | 'medium' | 'high'

export interface BimProfileSuggestion {
  key: string
  value: string | number
  confidence: BimSuggestionConfidence
  evidence: string
}

const ESCAPE_LEVEL_BANDS: Array<{ limit: number; band: string }> = [
  { limit: 7, band: '<=7m' },
  { limit: 11, band: '7-11m' },
  { limit: 22, band: '11-22m' },
  { limit: Number.POSITIVE_INFINITY, band: '>22m' },
]

const USE_MARKERS: Array<{ use: string; markers: string[] }> = [
  { use: 'residential', markers: ['wohn', 'schlafzimmer', 'kinderzimmer', 'küche', 'kueche', 'bad', 'wc '] },
  { use: 'office', markers: ['büro', 'buero', 'besprechung', 'office'] },
  { use: 'lodging', markers: ['hotel', 'gästezimmer', 'gaestezimmer', 'zimmer '] },
  { use: 'assembly', markers: ['saal', 'versammlung', 'foyer', 'aula'] },
  { use: 'healthcare', markers: ['patienten', 'behandlung', 'ordination', 'station'] },
  { use: 'manufacturing', markers: ['produktion', 'werkstatt', 'fertigung'] },
  { use: 'storage', markers: ['lager', 'archiv', 'abstellraum'] },
]

const NON_USE_MARKERS = ['flur', 'gang', 'treppe', 'stiege', 'technik', 'schacht', 'keller', 'garage']

function classifyUse(spaceNames: readonly string[]): { use: string; hits: number } | null {
  const tally = new Map<string, number>()
  for (const raw of spaceNames) {
    const name = raw.toLowerCase()
    if (NON_USE_MARKERS.some((marker) => name.includes(marker))) continue
    for (const { use, markers } of USE_MARKERS) {
      if (markers.some((marker) => name.includes(marker))) {
        tally.set(use, (tally.get(use) ?? 0) + 1)
        break
      }
    }
  }
  const ranked = [...tally.entries()].sort(([, a], [, b]) => b - a)
  const top = ranked[0]
  if (!top) return null
  if (top[1] < 2) return null
  if (ranked[1] && top[1] - ranked[1][1] <= 1) return null
  return { use: top[0], hits: top[1] }
}

export interface BimProfileInput {
  summary: BimModelSummary
  spaceNames: readonly string[]
}

export function deriveProfileSuggestions(input: BimProfileInput): BimProfileSuggestion[] {
  const { summary, spaceNames } = input
  const suggestions: BimProfileSuggestion[] = []

  const placed = summary.storeys.filter((storey) => storey.elevation !== null)
  if (placed.length > 0) {
    const above = placed.filter((storey) => (storey.elevation ?? 0) >= 0)
    const below = placed.filter((storey) => (storey.elevation ?? 0) < 0)

    suggestions.push({
      key: 'storeys_above_ground',
      value: above.length,
      confidence: placed.length === summary.storeys.length ? 'high' : 'medium',
      evidence: `${above.length} Geschoße mit Höhenlage ≥ 0 im Modell: ${above
        .map((storey) => storey.name ?? '—')
        .join(', ')}`,
    })

    if (below.length > 0) {
      suggestions.push({
        key: 'storeys_below_ground',
        value: below.length,
        confidence: placed.length === summary.storeys.length ? 'high' : 'medium',
        evidence: `${below.length} Geschoße mit negativer Höhenlage: ${below
          .map((storey) => `${storey.name ?? '—'} (${storey.elevation} m)`)
          .join(', ')}`,
      })
    }

    const occupied = placed.filter((storey) => storey.elementCount > 0)
    const highest = occupied.reduce<number | null>(
      (max, storey) => (max === null || (storey.elevation ?? 0) > max ? (storey.elevation ?? 0) : max),
      null
    )
    if (highest !== null) {
      const band = ESCAPE_LEVEL_BANDS.find((entry) => highest <= entry.limit)?.band
      if (band) {
        suggestions.push({
          key: 'escape_level',
          value: band,
          confidence: 'medium',
          evidence: `Oberstes belegtes Geschoß liegt bei ${highest} m (${
            occupied.find((storey) => storey.elevation === highest)?.name ?? '—'
          })`,
        })
      }
    }
  }

  const use = classifyUse(spaceNames)
  if (use) {
    suggestions.push({
      key: 'main_use',
      value: use.use,
      confidence: use.hits >= 5 ? 'medium' : 'low',
      evidence: `${use.hits} Räume im Modell tragen Namen dieser Nutzung`,
    })
  }

  if (summary.totals.spaces > 0) {
    suggestions.push({
      key: 'unit_count',
      value: summary.totals.spaces,
      confidence: 'low',
      evidence: `${summary.totals.spaces} Räume (IfcSpace) im Modell — nicht dasselbe wie Nutzungseinheiten`,
    })
  }

  return suggestions
}

export function renderProfileSuggestions(suggestions: readonly BimProfileSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'Aus dem Modell lassen sich keine Projektangaben ableiten.'
  }
  return suggestions
    .map(
      (suggestion) =>
        `${suggestion.key} = ${suggestion.value} (${suggestion.confidence}) — ${suggestion.evidence}`
    )
    .join('\n')
}
