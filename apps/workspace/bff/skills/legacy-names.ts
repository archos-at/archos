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

export function canonicalSkillName(name: string): string {
  return LEGACY_SKILL_NAMES[name] ?? name
}

export function legacyNamesOf(name: string): string[] {
  return Object.entries(LEGACY_SKILL_NAMES)
    .filter(([, current]) => current === name)
    .map(([legacy]) => legacy)
}
