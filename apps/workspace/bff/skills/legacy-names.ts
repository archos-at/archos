import { LEGACY_METADATA_KEYS, LEGACY_PLATFORM_SKILL_NAMES, type MetadataKey } from './legacy-brand-names'

export { LEGACY_METADATA_KEYS, LEGACY_PLATFORM_SKILL_NAMES, type MetadataKey }

export const LEGACY_SKILL_NAMES: Readonly<Record<string, string>> = {
  einreichcheck: 'submission-check',
  brandschutz: 'fire-safety',
  bestand: 'existing-building',
  nutzungssicherheit: 'safety-in-use',
  gebaeudeklasse: 'building-class',
  waermeschutz: 'thermal-protection',
  bebauung: 'plot-development',
  'pruefbericht-writer': 'inspection-report-writer',
}

const CURRENT_SKILL_NAME: Readonly<Record<string, string>> = {
  ...LEGACY_SKILL_NAMES,
  ...LEGACY_PLATFORM_SKILL_NAMES,
}

export function canonicalSkillName(name: string): string {
  return Object.hasOwn(CURRENT_SKILL_NAME, name) ? CURRENT_SKILL_NAME[name]! : name
}

export function legacyNamesOf(name: string): string[] {
  return Object.entries(CURRENT_SKILL_NAME)
    .filter(([, current]) => current === name)
    .map(([legacy]) => legacy)
}

export function skillNameFamily(name: string): string[] {
  const current = canonicalSkillName(name)
  return [current, ...legacyNamesOf(current)]
}

export function findSkillNamed<T extends { name: string }>(skills: readonly T[], name: string): T | undefined {
  return (
    skills.find((skill) => skill.name === name) ??
    skills.find((skill) => canonicalSkillName(skill.name) === canonicalSkillName(name))
  )
}

export function readMetadata(metadata: Readonly<Record<string, string>>, key: MetadataKey): string | undefined {
  return metadata[key] ?? metadata[LEGACY_METADATA_KEYS[key]]
}

export function writtenMetadataKey(key: MetadataKey): string {
  return LEGACY_METADATA_KEYS[key]
}
