/**
 * Consolidation primitives shared by every knowledge store that de-duplicates
 * natural-language findings at write time — project/organization memory
 * (`lib/projects/memory-service.ts`) and platform lessons
 * (`lib/platform-lessons`).
 *
 * Extracted from the memory service rather than re-implemented: the polarity
 * split in particular encodes a failure mode ("a correction is token-wise
 * nearly identical to the claim it corrects") that any second copy would
 * re-learn the hard way. One engine, two stores
 * (docs/architecture/platform-failure-learning.md, "shared substrate").
 */

/**
 * Normalize content for duplicate detection: lowercase, non-alphanumerics
 * collapsed to single spaces, trimmed. ASCII-only on purpose — umlauts fold to
 * spaces. Must stay in lock-step with the SQL expression in the
 * project_memory partial unique indexes (migration 0010):
 * `btrim(regexp_replace(lower(content), '[^a-z0-9]+', ' ', 'g'))`.
 */
export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The German-preserving twin: keeps ä/ö/ü/ß, because "Maß" and "Mas" are
 * different words and a German compliance product must not merge across them.
 * Lock-step partner: the `uniq_platform_lessons_content_live` index expression
 * in migration 0068 (`[^a-z0-9äöüß]+`).
 *
 * NOT adopted by project memory: its 0010 index expressions are already
 * deployed with the ASCII fold, and the JS normalizer must match the index or
 * the 23505 race backstop stops matching what the check matched. Migrating
 * memory to this normalizer means rewriting those indexes in the same change.
 */
export function normalizeContentGerman(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
}

/**
 * Token overlap above which two same-kind findings are the same fact restated
 * (paraphrase-level dedup). Deliberately high: a false positive merges two
 * distinct findings and loses one; a false negative only costs a redundant row
 * a curator can prune.
 */
export const NEAR_DUP_JACCARD_THRESHOLD = 0.8
/** Very short findings have jumpy token sets; keep them exact-dup only. */
export const NEAR_DUP_MIN_TOKENS = 3

/**
 * Negation particles whose presence flips what a finding asserts.
 *
 * A correction is token-wise almost identical to the claim it corrects:
 * "OIB-RL 2.1 is not applicable" vs "OIB-RL 2.1 is applicable" score 0.91
 * Jaccard, well over NEAR_DUP_JACCARD_THRESHOLD. Merging those keeps the OLD
 * row and only refreshes its confidence and timestamps — so the correction is
 * discarded and the stale claim survives looking freshly confirmed. Polarity is
 * therefore checked BEFORE any merge: opposed polarity is a contradiction, and
 * a contradiction supersedes instead of merging.
 */
const NEGATION_TOKENS = new Set([
  // English
  'not',
  'no',
  'never',
  'without',
  'cannot',
  'none',
  'neither',
  'nor',
  // German
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

/**
 * Boolean literals, which flip meaning the same way a negation does — findings
 * routinely carry flag values verbatim ("commercial_facility=false").
 */
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

/**
 * A comparable summary of what a content asserts: negation PARITY (double
 * negation reads positive again) plus the boolean literals it carries. Two
 * contents whose signatures differ assert opposite things.
 */
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

/**
 * What a near-duplicate is to the note it resembles.
 *
 * - `same`: the new note asserts nothing the old one does not (its tokens and
 *   its numbers are all in the old note, in the same polarity). The old text
 *   stays; only its recency is refreshed.
 * - `corrected`: the two differ in what they ASSERT: a number, a date, a
 *   negation, a comparison mark, or a word swapped for another in an
 *   otherwise identical sentence ("in Lärche" → "in Eiche"). The new note
 *   replaces the old one.
 * - `restated`: the same statement in other words, as far as text can tell:
 *   a pair only the vector matched, or one that only ADDS words („Ein
 *   Flachdach ist gewünscht“). It merges like `same`: superseding every
 *   rewording would retire a note's recall history each time the agent says
 *   it again.
 *
 * Why it is not a polarity check alone: "Die Attika ist 1,10 m hoch" and
 * "… 1,20 m hoch" share every token but one and carry no negation, so they
 * merged, the stale value stayed and came back looking freshly confirmed.
 */
export type AssertionRelation = 'same' | 'restated' | 'corrected'

/** One number as written: digits, with any `.` or `,` groups. */
const NUMBER_SHAPE = /\d+(?:[.,]\d+)*/g
/** `1.200` or `12.500.000`: a point every three digits groups thousands. */
const POINT_THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/
/** Marks that turn a bound around without adding a word. */
const COMPARISON_MARKS = /[<>≤≥≠±]/g

/**
 * One written number in a comparable form: German decimal comma and thousands
 * point read as a value (`1,10` is `1.1`, `1.200,50` is `1200.5`), anything
 * with several separators of one kind kept as written (a date `12.03.2027`, a
 * clause `3.2.1`).
 */
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

/** The numbers a note states, in the order it states them. */
export function assertedNumbers(content: string): string[] {
  return (content.match(NUMBER_SHAPE) ?? []).map(canonicalNumber)
}

function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0
  for (const value of whole) if (at < part.length && value === part[at]) at++
  return at === part.length
}

const comparisonMarks = (content: string): string => (content.match(COMPARISON_MARKS) ?? []).join('')

/**
 * Classify `incoming` against the `existing` note it nearly duplicates. Meant
 * for a pair a similarity gate already matched (cosine, or token overlap at
 * `NEAR_DUP_JACCARD_THRESHOLD`); it does not judge similarity itself, except
 * that a lexically near pair in which each side has a word the other lacks
 * is a deliberate edit of that sentence, hence `corrected`.
 *
 * Numbers are compared as an ordered sequence, so "2 Stiegen, 3 Aufzüge" does
 * not pass for "3 Stiegen, 2 Aufzüge". What it cannot see: two notes with the
 * same words and numbers in another order ("A vor B" / "B vor A"), a
 * correction that only adds a word with no number in it ("Bauteil B" →
 * "Bauteil B und C"), and a
 * paraphrase that swaps a name while sharing few tokens with the old note.
 */
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
  // A word swapped in a near sentence („in Lärche“ → „in Eiche“): each side has a word the other lacks.
  const swapped = [...existingTokens].some((token) => !incomingTokens.has(token))
  return swapped && jaccardSimilarity(incomingTokens, existingTokens) >= NEAR_DUP_JACCARD_THRESHOLD ? 'corrected' : 'restated'
}
