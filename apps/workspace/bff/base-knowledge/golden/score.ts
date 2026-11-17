import type { GoldenAnswer, GoldenAnswerSource, GoldenCase, GoldenCaseMustNot, GoldenCheck, GoldenScores } from '../wire/golden-case'

export function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim()
}

const WORD = /[\p{L}\p{N}]/u

export function holdsPhrase(text: string, phrase: string): boolean {
  const haystack = normalized(text)
  const needle = normalized(phrase)
  if (!needle) return false
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1] ?? ' '
    const after = haystack[at + needle.length] ?? ' '
    const openEdge = !(WORD.test(needle[0] ?? '') && WORD.test(before))
    const closeEdge = !(WORD.test(needle[needle.length - 1] ?? '') && WORD.test(after))
    if (openEdge && closeEdge) return true
  }
  return false
}

const holdsAny = (text: string, phrases: readonly string[]) => phrases.some((phrase) => holdsPhrase(text, phrase))

const sourceText = (source: GoldenAnswerSource) => [source.name, source.documentId, source.url, source.clause].filter(Boolean).join(' | ')

function valueChecks(golden: GoldenCase, answer: GoldenAnswer): GoldenCheck[] {
  return golden.expected.values.map((value) => {
    const passed = holdsAny(answer.text, value.anyOf)
    return {
      kind: 'value',
      id: value.label,
      passed,
      decides: value.grounding !== 'unconfirmed',
      detail: passed ? 'present' : `none of ${value.anyOf.map((option) => `"${option}"`).join(', ')} is in the answer`,
    }
  })
}

function editionChecks(golden: GoldenCase, answer: GoldenAnswer): GoldenCheck[] {
  const edition = golden.expected.edition
  if (!edition) return []
  const passed = holdsAny(answer.text, edition.anyOf) || answer.sources.some((source) => holdsAny(source.name, edition.anyOf))
  return [
    {
      kind: 'edition',
      id: edition.editionKey,
      passed,
      decides: edition.grounding !== 'unconfirmed',
      detail: passed ? 'named' : 'neither the answer nor a cited source names the edition',
    },
  ]
}

function citationChecks(golden: GoldenCase, answer: GoldenAnswer): GoldenCheck[] {
  return golden.expected.citations.map((citation) => {
    const names = [citation.designation, ...citation.alsoKnownAs]
    const cited = answer.sources.filter((source) => holdsAny(sourceText(source), names))
    const located = citation.locus === null || holdsPhrase(answer.text, citation.locus) || cited.some((source) => holdsPhrase(sourceText(source), citation.locus ?? ''))
    const passed = cited.length > 0 && located
    return {
      kind: 'citation',
      id: citation.designation,
      passed,
      decides: citation.grounding !== 'unconfirmed',
      detail: passed ? 'resolves' : cited.length === 0 ? 'no cited source carries the designation' : `the locus "${citation.locus}" is neither in the answer nor on the source`,
    }
  })
}

function recordsStateApplies(rule: Extract<GoldenCaseMustNot, { kind: 'phrase' }>, answer: GoldenAnswer): boolean {
  return rule.whenRecords === 'any' || (rule.whenRecords === 'released') === answer.recordsReleased
}

function violation(rule: GoldenCaseMustNot, answer: GoldenAnswer): string | null {
  if (rule.kind === 'source') {
    const hit = answer.sources.find((source) => source.kind !== undefined && rule.sourceKinds.includes(source.kind) && (rule.naming.length === 0 || holdsAny(sourceText(source), rule.naming)))
    return hit ? `cites "${hit.name}" (${hit.kind})` : null
  }
  if (!recordsStateApplies(rule, answer)) return null
  const level = answer.confidence?.level
  if (rule.whenConfidence.length > 0 && !(level && rule.whenConfidence.includes(level))) return null
  const text = rule.in === 'confidence_reason' ? (answer.confidence?.reason ?? '') : answer.text
  const found = rule.anyOf.find((phrase) => holdsPhrase(text, phrase))
  return found ? `"${found}" in the ${rule.in === 'confidence_reason' ? 'confidence reason' : 'answer'}` : null
}

function mustNotChecks(golden: GoldenCase, answer: GoldenAnswer): GoldenCheck[] {
  return golden.mustNot.map((rule) => {
    const why = violation(rule, answer)
    return { kind: 'must_not', id: rule.id, passed: why === null, decides: true, detail: why ?? 'kept' }
  })
}

const share = (checks: readonly GoldenCheck[]) => Math.round((checks.filter((check) => check.passed).length / checks.length) * 10_000) / 10_000

export interface ScoredCase {
  passed: boolean
  checks: GoldenCheck[]
  scores: GoldenScores
  unconfirmed: number
  unverified: boolean
}

export function scoreGoldenCase(golden: GoldenCase, answer: GoldenAnswer): ScoredCase {
  const values = valueChecks(golden, answer)
  const edition = editionChecks(golden, answer)
  const citations = citationChecks(golden, answer)
  const mustNot = mustNotChecks(golden, answer)
  const checks = [...values, ...edition, ...citations, ...mustNot]
  const unverified = !checks.some((check) => check.decides)
  const passed = !unverified && checks.every((check) => check.passed || !check.decides)
  const scores: GoldenScores = {
    'golden-case-passed': passed,
    'golden-must-not-violations': mustNot.filter((check) => !check.passed).length,
  }
  if (values.length > 0) scores['golden-expected-values'] = share(values)
  if (citations.length > 0) {
    scores['claim-citation-resolves'] = citations.every((check) => check.passed)
  }
  return { passed, checks, scores, unconfirmed: checks.filter((check) => !check.decides).length, unverified }
}
