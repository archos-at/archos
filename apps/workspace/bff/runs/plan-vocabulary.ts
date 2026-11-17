export const LEGACY_PLAN_GENRE: Readonly<Record<string, string>> = {
  pruefbericht: 'inspection_report',
  aktenvermerk: 'file_note',
  vergleich: 'comparison',
  checkliste: 'checklist',
  bericht: 'report',
}

export const LEGACY_PLAN_DEPTH: Readonly<Record<string, string>> = {
  kurzpruefung: 'quick_check',
  gutachten: 'expert_report',
}

export const LEGACY_PLAN_KEYS: Readonly<Record<string, string>> = {
  grundlage: 'basis',
  ausgeschlossen: 'excluded',
  unterlagen: 'documents',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function modernizePlan<T>(raw: T): T | Record<string, unknown> {
  if (!isRecord(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  for (const [old, next] of Object.entries(LEGACY_PLAN_KEYS)) {
    if (!(old in out)) continue
    if (!(next in out)) out[next] = out[old]
    delete out[old]
  }
  if (typeof out.genre === 'string') out.genre = LEGACY_PLAN_GENRE[out.genre] ?? out.genre
  if (typeof out.depth === 'string') out.depth = LEGACY_PLAN_DEPTH[out.depth] ?? out.depth
  return out
}
