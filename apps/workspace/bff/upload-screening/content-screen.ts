import type { ScreeningDetector } from './policy'
import {
  type ContentFinding,
  type ContentScreenKind,
  type ContentScreenRules,
  type ContentSpan,
  type MaskedText,
  SCREENING_PLACEHOLDERS,
} from './content-types'
import { cardSpans } from './card-spans'
import { originalSpan, read } from './hyphenation'
import { deSvnrSpans, deTaxIdSpans, ibanSpans, svnrSpans } from './number-spans'
import { termSpans } from './term-matching'

export { luhnValid } from './card-numbers'
export { validAtSvnr } from './svnr-numbers'
export { decimalDigitValue, SCREENING_WHITESPACE } from './screen-chars'
export { buildContentRules, chatScreeningRules } from './content-rules'
export { foldContent } from './content-folding'
export { IBAN_LENGTHS, validIban } from './iban-numbers'
export { SCREENING_PLACEHOLDERS }
export type { ContentFinding, ContentScreenKind, ContentScreenRules, ContentSpan, MaskedText }

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

const DETECTOR_SPANS: Readonly<
  Record<ScreeningDetector, (text: string, soft: ReadonlySet<number>) => Iterable<ContentSpan>>
> =
  {
    iban: ibanSpans,
    at_svnr: svnrSpans,
    credit_card: cardSpans,
    de_svnr: deSvnrSpans,
    de_tax_id: deTaxIdSpans,
  }

const PLACEHOLDER_RE = new RegExp(
  Object.values(SCREENING_PLACEHOLDERS).map(escapeRegExp).join('|'),
  'g'
)

const NUMBER_KINDS: ReadonlySet<ContentScreenKind> = new Set(['at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'])

function outsideIbans(spans: readonly ContentSpan[]): ContentSpan[] {
  const ibans = spans.filter((span) => span.kind === 'iban')
  return spans.filter(
    (span) =>
      !NUMBER_KINDS.has(span.kind) ||
      !ibans.some((iban) => iban.start <= span.start && span.end <= iban.end)
  )
}

export function findSpans(text: string, rules: ContentScreenRules): ContentSpan[] {
  if (!text) return []
  const protectedRegions = [...text.matchAll(PLACEHOLDER_RE)].map(
    (match) => [match.index, match.index + match[0].length] as const
  )
  const reading = read(text)
  const spans = [...termSpans(reading.text, rules)]
  for (const name of rules.detectors) spans.push(...DETECTOR_SPANS[name](reading.text, reading.soft))
  return outsideIbans(spans)
    .map((span) => {
      const [start, end] = originalSpan(reading, span.start, span.end)
      return { ...span, start, end }
    })
    .filter((span) => !protectedRegions.some(([start, end]) => span.start < end && start < span.end))
}

function merged(spans: readonly ContentSpan[]): ContentSpan[] {
  const out: ContentSpan[] = []
  const ordered = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  for (const span of ordered) {
    const last = out[out.length - 1]
    if (last && span.start < last.end)
      out[out.length - 1] = { ...last, end: Math.max(last.end, span.end) }
    else out.push(span)
  }
  return out
}

function replaced(text: string, spans: readonly ContentSpan[]): string {
  let out = ''
  let cursor = 0
  for (const span of merged(spans)) {
    out += text.slice(cursor, span.start) + SCREENING_PLACEHOLDERS[span.kind]
    cursor = span.end
  }
  return out + text.slice(cursor)
}

function findingsOf(spans: readonly ContentSpan[], rules: ContentScreenRules): ContentFinding[] {
  const order: Array<{ kind: ContentScreenKind; term?: string }> = [
    ...rules.terms.map((term) => ({ kind: 'term' as const, term })),
    ...rules.detectors.map((kind) => ({ kind })),
  ]
  const findings: ContentFinding[] = []
  for (const rule of order) {
    const matched = spans.filter((span) => span.kind === rule.kind && span.term === rule.term)
    if (matched.length === 0) continue
    const finding: ContentFinding = { kind: rule.kind, count: matched.length }
    if (rule.term !== undefined) finding.term = rule.term
    if (matched[0].sample !== undefined) finding.sample = matched[0].sample
    findings.push(finding)
  }
  return findings
}

export function maskText(text: string, rules: ContentScreenRules | null): MaskedText {
  if (!rules || !text) return { text, findings: [] }
  const found: ContentSpan[] = []
  let current = text
  let spans = findSpans(current, rules)
  while (spans.length > 0) {
    found.push(...spans)
    current = replaced(current, spans)
    spans = findSpans(current, rules)
  }
  return { text: current, findings: findingsOf(found, rules) }
}
