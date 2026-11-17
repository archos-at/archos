import type { Translator } from '@/i18n'

export const DOCUMENT_TYPE_TAGS = [
  'Bebauungsplan',
  'Flächenwidmungsplan',
  'Grundriss',
  'Schnitt',
  'Ansicht',
  'Detail',
  'Gutachten',
  'Bescheid',
  'Norm/Richtlinie',
  'Vertrag',
  'correspondence',
  'Foto',
  'Sonstiges',
] as const

export const DISCIPLINE_TAGS = [
  'Standsicherheit',
  'Brandschutz',
  'Hygiene/Gesundheit/Umweltschutz',
  'Nutzungssicherheit/Barrierefreiheit',
  'Schallschutz',
  'Energieeinsparung/Wärmeschutz',
] as const

export type DocumentTypeTag = (typeof DOCUMENT_TYPE_TAGS)[number]
export type DisciplineTag = (typeof DISCIPLINE_TAGS)[number]
export type ControlledTag = DocumentTypeTag | DisciplineTag

export const ALLOWED_TAGS: ReadonlySet<string> = new Set<string>([...DOCUMENT_TYPE_TAGS, ...DISCIPLINE_TAGS])

export const MAX_TAGS = 5

export const MAX_TOPICS = 6
export const MAX_TOPIC_LENGTH = 40

export const TAG_GROUPS = [
  { id: 'documentType', tags: DOCUMENT_TYPE_TAGS },
  { id: 'discipline', tags: DISCIPLINE_TAGS },
] as const

export type TagGroupId = (typeof TAG_GROUPS)[number]['id']

export function documentTypeOf(tags: readonly string[] | null | undefined): DocumentTypeTag | undefined {
  return (tags ?? []).find((tag): tag is DocumentTypeTag => (DOCUMENT_TYPE_TAGS as readonly string[]).includes(tag))
}

export const LABELLED_TAGS = [
  'correspondence',
] as const

export type LabelledTag = (typeof LABELLED_TAGS)[number]

function isLabelledTag(tag: string): tag is LabelledTag {
  return (LABELLED_TAGS as readonly string[]).includes(tag)
}

export function tagLabel(tag: string, t: Translator): string {
  if (isLabelledTag(tag)) return t(`documentTag.${tag}`)
  const token = STORED_GERMAN_TAG_LABELS.get(tag)
  return token ? t(`documentTag.${token}`) : tag
}

const STORED_GERMAN_TAG_LABELS: ReadonlyMap<string, string> = new Map([
  ['Bebauungsplan', 'developmentPlan'],
  ['Flächenwidmungsplan', 'zoningPlan'],
  ['Grundriss', 'floorPlan'],
  ['Schnitt', 'section'],
  ['Ansicht', 'elevation'],
  ['Detail', 'detail'],
  ['Gutachten', 'expertReport'],
  ['Bescheid', 'officialDecision'],
  ['Norm/Richtlinie', 'standard'],
  ['Vertrag', 'contract'],
  ['Foto', 'photo'],
  ['Sonstiges', 'other'],
  ['Standsicherheit', 'structuralSafety'],
  ['Brandschutz', 'fireSafety'],
  ['Hygiene/Gesundheit/Umweltschutz', 'hygieneHealthEnvironment'],
  ['Nutzungssicherheit/Barrierefreiheit', 'safetyInUse'],
  ['Schallschutz', 'soundProtection'],
  ['Energieeinsparung/Wärmeschutz', 'energyEconomy'],
])

export function areTagsValid(tags: readonly string[]): boolean {
  return tags.every((tag) => ALLOWED_TAGS.has(tag))
}
