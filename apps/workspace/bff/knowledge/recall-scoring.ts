export const WEIGHT_RELEVANCE = 3
export const WEIGHT_IMPORTANCE = 2
export const WEIGHT_RECENCY = 0.5

export const RECENCY_DECAY = 0.99

const BASE_FLOOR = 0.5

export const REINFORCEMENT_MIN = 0.3
export const REINFORCEMENT_MAX = 1.5

export interface ScorableNote {
  relevance: number | null
  importance: number
  daysSinceUse: number | null
  timesUsed: number
}

export function reinforcementMultiplier(daysSinceUse: number | null, timesUsed: number): number {
  if (daysSinceUse === null) return 1
  const strength = 1 + Math.max(0, timesUsed)
  const retention = Math.exp(-Math.max(0, daysSinceUse) / strength)
  const scaled = REINFORCEMENT_MIN + retention * (REINFORCEMENT_MAX - REINFORCEMENT_MIN)
  return Math.min(REINFORCEMENT_MAX, Math.max(REINFORCEMENT_MIN, scaled))
}

function normalize(values: number[]): number[] {
  if (values.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const span = max - min
  if (span === 0) return values.map(() => 0)
  return values.map((value) => (value - min) / span)
}

export function rankByRecallScore(notes: ScorableNote[]): { index: number; score: number }[] {
  if (notes.length === 0) return []

  const relevance = normalize(notes.map((note) => note.relevance ?? 0))
  const importance = normalize(notes.map((note) => note.importance))
  const recency = normalize(notes.map((_, index) => RECENCY_DECAY ** (index + 1)))

  return notes
    .map((note, index) => {
      const base =
        BASE_FLOOR +
        WEIGHT_RELEVANCE * relevance[index] +
        WEIGHT_IMPORTANCE * importance[index] +
        WEIGHT_RECENCY * recency[index]
      return {
        index,
        score: base * reinforcementMultiplier(note.daysSinceUse, note.timesUsed),
      }
    })
    .sort((a, b) => b.score - a.score)
}

export const RRF_K = 60

export function fuseHybridRelevance(
  dense: (number | null)[],
  lexical: number[]
): (number | null)[] {
  const contributions = new Array<number>(dense.length).fill(0)
  let anyContribution = false

  for (const channel of [dense, lexical.map((value) => (value > 0 ? value : null))]) {
    const ranked = channel
      .map((score, index) => ({ score, index }))
      .filter((entry): entry is { score: number; index: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
    ranked.forEach((entry, rank) => {
      contributions[entry.index] += 1 / (RRF_K + rank + 1)
      anyContribution = true
    })
  }

  if (!anyContribution) return dense.map(() => null)
  return contributions.map((value) => (value > 0 ? value : null))
}

export function daysSince(then: Date | null | undefined): number | null {
  if (!then) return null
  return Math.max(0, (Date.now() - then.getTime()) / (24 * 60 * 60 * 1000))
}
