export const legalSlugs = [
  'imprint',
  'privacy',
  'terms',
  'ai-transparency',
  'subprocessors',
] as const

export type LegalSlug = (typeof legalSlugs)[number]

export function isLegalSlug(value: string): value is LegalSlug {
  return (legalSlugs as readonly string[]).includes(value)
}

export interface LegalTable {
  headers: string[]
  rows: string[][]
}

export interface LegalSection {
  heading?: string
  paragraphs?: string[]
  list?: string[]
  table?: LegalTable
  notice?: string
}

export interface LegalDocument {
  title: string
  updated: string
  intro?: string
  sections: LegalSection[]
}

export type LegalContent = Record<LegalSlug, LegalDocument>
