import { codePointLength } from './code-points'
import { foldContent } from './content-folding'
import type { ContentScreenRules } from './content-types'
import { SCREENING_DETECTORS, type UploadScreeningPolicy } from './policy'

const MAX_TERMS = 200
const MIN_TERM_CHARS = 2
const MAX_TERM_CHARS = 80

const SPACE_RUN = /[\t-\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u

function splitWords(text: string): string[] {
  return text.split(SPACE_RUN).filter(Boolean)
}

function termPattern(term: string): string[] {
  return splitWords(foldContent(term))
}

function normalisedTerms(terms: readonly string[]): string[] {
  const kept = new Map<string, string>()
  for (const term of terms) {
    const stripped = splitWords(term).join(' ')
    const length = codePointLength(stripped)
    if (length < MIN_TERM_CHARS || length > MAX_TERM_CHARS) continue
    const key = foldContent(stripped)
    if (!kept.has(key)) kept.set(key, stripped)
  }
  return [...kept.values()].slice(0, MAX_TERMS)
}

export function buildContentRules(
  terms: readonly string[],
  detectors: readonly string[]
): ContentScreenRules | null {
  const keptTerms = normalisedTerms(terms)
  const wanted = new Set(detectors)
  const keptDetectors = SCREENING_DETECTORS.filter((name) => wanted.has(name))
  if (keptTerms.length === 0 && keptDetectors.length === 0) return null
  return { terms: keptTerms, detectors: keptDetectors, patterns: keptTerms.map(termPattern) }
}

export function chatScreeningRules(policy: UploadScreeningPolicy): ContentScreenRules | null {
  if (!policy.enabled) return null
  return buildContentRules(policy.contentTerms, policy.detectors)
}
