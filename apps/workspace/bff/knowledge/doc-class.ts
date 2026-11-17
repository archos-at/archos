import { authorityTag, kindForLane, KIND_TO_SIGNAL, type SourceSignal } from '@/lib/source-kinds'

export const DOC_CLASSES = [
  'oib_guideline',
  'oib_guide',
  'oib_explanatory_note',
  'oib_definitions',
  'oib_reference',
  'oib_amendment',
  'external_standard',
  'law',
  'other',
] as const

export type DocClass = (typeof DOC_CLASSES)[number]

export const DOC_CLASS_LABELS: Record<DocClass, string> = {
  oib_guideline: 'OIB-Richtlinie',
  oib_guide: 'OIB-Leitfaden',
  oib_explanatory_note: 'OIB-Erläuterung',
  oib_definitions: 'OIB-Begriffsbestimmungen',
  oib_reference: 'OIB-Referenzdokument',
  oib_amendment: 'OIB-Änderungsdokument',
  external_standard: 'Norm (ÖNORM u.a.)',
  law: 'Gesetz / Bauordnung',
  other: 'Sonstiges Basisdokument',
}

export const DEFAULT_DOC_CLASS: DocClass = 'other'

const DOC_CLASS_LANES: Record<DocClass, string> = {
  oib_guideline: 'building_law_oib',
  oib_guide: 'building_law_oib_guide',
  oib_explanatory_note: 'building_law_oib_explanatory_note',
  oib_definitions: 'building_law_oib_definitions',
  oib_reference: 'building_law_oib_reference',
  oib_amendment: 'building_law_oib_amendment',
  external_standard: 'external_standard',
  law: 'building_law_ris',
  other: 'building_law_base',
}

export const LEGACY_DOC_CLASSES: Readonly<Record<string, DocClass>> = {
  oib_richtlinie: 'oib_guideline',
  oib_leitfaden: 'oib_guide',
  oib_erlaeuterung: 'oib_explanatory_note',
  oib_begriffe: 'oib_definitions',
  oib_referenz: 'oib_reference',
  oib_aenderung: 'oib_amendment',
  norm_extern: 'external_standard',
  gesetz: 'law',
  sonstiges: 'other',
}

export const asDocClass = (value: string | null | undefined): DocClass | undefined => {
  if (!value) return undefined
  const current = LEGACY_DOC_CLASSES[value] ?? value
  return (DOC_CLASSES as readonly string[]).includes(current) ? (current as DocClass) : undefined
}

export const resolveDocClass = (value: string | null | undefined): DocClass =>
  asDocClass(value) ?? DEFAULT_DOC_CLASS

export const suggestedDocClass = (file: {
  docClass: string | null
  docClassSuggestion: string | null
}): DocClass | undefined => {
  const suggestion = asDocClass(file.docClassSuggestion)
  return suggestion && suggestion !== resolveDocClass(file.docClass) ? suggestion : undefined
}

export const docClassSignal = (docClass: string | null | undefined): SourceSignal =>
  KIND_TO_SIGNAL[kindForLane(DOC_CLASS_LANES[resolveDocClass(docClass)])]

export const docClassAuthority = (
  docClass: string | null | undefined
): 'OIB' | 'RIS' | 'ÖNORM' | null => {
  const tag = authorityTag(DOC_CLASS_LANES[resolveDocClass(docClass)])
  return tag === 'OIB' || tag === 'RIS' || tag === 'ÖNORM' ? tag : null
}

export const isOibBinding = (docClass: string | null | undefined): boolean =>
  resolveDocClass(docClass).startsWith('oib_')
