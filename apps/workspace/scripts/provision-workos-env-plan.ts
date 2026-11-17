export function splitList(raw: string | undefined): string[] {
  const seen = new Set<string>()
  for (const part of raw?.split(',') ?? []) {
    const value = part.trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

export function diffSets(
  desired: readonly string[],
  current: readonly string[]
): { missing: string[]; extra: string[] } {
  const wanted = new Set(desired)
  const present = new Set(current)
  const missing = [...new Set(desired)].filter((value) => !present.has(value)).sort()
  const extra = [...new Set(current)].filter((value) => !wanted.has(value)).sort()
  return { missing, extra }
}

export interface FlagTargetEntry {
  slug: string
  orgIds: string[]
}

export type FlagTargetsParse =
  | { ok: true; entries: FlagTargetEntry[] }
  | { ok: false; error: string }

export function parseFlagTargets(raw: string | undefined): FlagTargetsParse {
  if (!raw || !raw.trim()) return { ok: true, entries: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, error: `not valid JSON: ${String(error)}` }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'expected a JSON object mapping flag slugs to arrays of org ids' }
  }

  const entries: FlagTargetEntry[] = []
  for (const [rawSlug, rawOrgIds] of Object.entries(parsed)) {
    const slug = rawSlug.trim()
    if (!slug) return { ok: false, error: 'found an empty flag slug key' }
    if (!Array.isArray(rawOrgIds)) {
      return { ok: false, error: `value for "${slug}" must be an array of org ids` }
    }
    const orgIds = splitList(rawOrgIds.map(String).join(','))
    if (orgIds.length === 0) {
      return { ok: false, error: `value for "${slug}" must contain at least one org id` }
    }
    entries.push({ slug, orgIds })
  }
  return { ok: true, entries }
}

export interface FlagCheckPlan {
  ok: boolean
  present: string[]
  missing: string[]
  unknown: string[]
}

export function planFlagCheck(registry: readonly string[], environment: readonly string[]): FlagCheckPlan {
  const { missing, extra } = diffSets(registry, environment)
  const have = new Set(environment)
  const present = [...new Set(registry)].filter((slug) => have.has(slug)).sort()
  return { ok: missing.length === 0, present, missing, unknown: extra }
}
