export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeContentGerman(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
}

export const NEAR_DUP_JACCARD_THRESHOLD = 0.8
export const NEAR_DUP_MIN_TOKENS = 3

const NEGATION_TOKENS = new Set([
  'not',
  'no',
  'never',
  'without',
  'cannot',
  'none',
  'neither',
  'nor',
  'nicht',
  'kein',
  'keine',
  'keinen',
  'keinem',
  'keiner',
  'keines',
  'nie',
  'niemals',
  'ohne',
  'weder',
])

const BOOLEAN_TOKENS = new Set(['true', 'false', 'yes', 'ja', 'nein', 'wahr', 'falsch'])

export function contentTokenList(
  content: string,
  normalize: (content: string) => string = normalizeContent
): string[] {
  return normalize(content).split(' ').filter(Boolean)
}

export function contentTokens(
  content: string,
  normalize: (content: string) => string = normalizeContent
): Set<string> {
  return new Set(contentTokenList(content, normalize))
}

export function polaritySignature(
  content: string,
  normalize: (content: string) => string = normalizeContent
): string {
  let negations = 0
  const booleans: string[] = []
  for (const token of contentTokenList(content, normalize)) {
    if (NEGATION_TOKENS.has(token)) negations++
    else if (BOOLEAN_TOKENS.has(token)) booleans.push(token)
  }
  return `${negations % 2}|${[...new Set(booleans)].sort().join(',')}`
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

export type AssertionRelation = 'same' | 'restated' | 'corrected'

const NUMBER_SHAPE = /\d+(?:[.,]\d+)*/g
const POINT_THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/
const COMPARISON_MARKS = /[<>≤≥≠±]/g

function canonicalNumber(written: string): string {
  const points = written.split('.').length - 1
  const commas = written.split(',').length - 1
  let value: string | null = null
  if (commas === 1 && (points === 0 || written.indexOf(',') > written.lastIndexOf('.'))) {
    value = written.replace(/\./g, '').replace(',', '.')
  } else if (commas === 0 && POINT_THOUSANDS.test(written)) {
    value = written.replace(/\./g, '')
  } else if (commas === 0 && points <= 1) {
    value = written
  }
  return value === null ? written : String(Number.parseFloat(value))
}

export function assertedNumbers(content: string): string[] {
  return (content.match(NUMBER_SHAPE) ?? []).map(canonicalNumber)
}

function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0
  for (const value of whole) if (at < part.length && value === part[at]) at++
  return at === part.length
}

const comparisonMarks = (content: string): string => (content.match(COMPARISON_MARKS) ?? []).join('')

export function assertionRelation(incoming: string, existing: string): AssertionRelation {
  if (
    polaritySignature(incoming) !== polaritySignature(existing) ||
    comparisonMarks(incoming) !== comparisonMarks(existing) ||
    !isSubsequence(assertedNumbers(incoming), assertedNumbers(existing))
  ) {
    return 'corrected'
  }
  const incomingTokens = contentTokens(incoming)
  const existingTokens = contentTokens(existing)
  if ([...incomingTokens].every((token) => existingTokens.has(token))) return 'same'
  const swapped = [...existingTokens].some((token) => !incomingTokens.has(token))
  return swapped && jaccardSimilarity(incomingTokens, existingTokens) >= NEAR_DUP_JACCARD_THRESHOLD ? 'corrected' : 'restated'
}
