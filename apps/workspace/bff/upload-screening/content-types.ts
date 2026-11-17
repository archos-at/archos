import type { ScreeningDetector } from './policy'

export type ContentScreenKind = ScreeningDetector | 'term'

export const SCREENING_PLACEHOLDERS: Readonly<Record<ContentScreenKind, string>> = {
  iban: '[IBAN entfernt]',
  at_svnr: '[SV-Nummer entfernt]',
  credit_card: '[Kartennummer entfernt]',
  de_svnr: '[RV-Nummer entfernt]',
  de_tax_id: '[Steuer-ID entfernt]',
  term: '[Begriff entfernt]',
}

export interface ContentScreenRules {
  terms: readonly string[]
  detectors: readonly ScreeningDetector[]
  patterns: readonly (readonly string[])[]
}

export interface ContentSpan {
  kind: ContentScreenKind
  start: number
  end: number
  term?: string
  sample?: string
}

export interface ContentFinding {
  kind: ContentScreenKind
  count: number
  term?: string
  sample?: string
}

export interface MaskedText {
  text: string
  findings: ContentFinding[]
}
