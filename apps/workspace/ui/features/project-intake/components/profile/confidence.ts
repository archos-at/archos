import type { ProfileEvidence, Suggestion } from '@/lib/project-intake/types'

export type ConfidenceLevel =
  | 'confirmed'
  | 'contested'
  | 'corroborated'
  | 'single'
  | 'unsupported'

export interface Confidence {
  level: ConfidenceLevel
  count: number
  ownAnswer: boolean
}

export function distinctSources(evidence: readonly ProfileEvidence[]): number {
  const sources = new Set<string>()
  for (const entry of evidence) {
    if (entry.kind === 'person') continue
    sources.add(entry.kind === 'document' ? `document:${entry.fileName.normalize('NFC').toLowerCase()}` : entry.kind)
  }
  return sources.size
}

export interface ConfidenceSource {
  state: Suggestion['state']
  evidence: readonly ProfileEvidence[]
  alternatives: readonly Suggestion['alternatives'][number][]
}

export function confidenceOf(item: ConfidenceSource): Confidence {
  const ownAnswer = item.evidence.length > 0 && item.evidence.every((entry) => entry.kind === 'person')
  if (item.state === 'contested') {
    return { level: 'contested', count: 1 + item.alternatives.length, ownAnswer: false }
  }
  const count = distinctSources(item.evidence)
  if (item.state === 'confirmed') return { level: 'confirmed', count, ownAnswer }
  if (count >= 2) return { level: 'corroborated', count, ownAnswer: false }
  if (count === 1) return { level: 'single', count, ownAnswer: false }
  return { level: 'unsupported', count, ownAnswer: false }
}
