import { flattenIntakeQuestions } from './intake-conditions'
import { projectIntakeDefinitionV1 } from './intake-definition'
import { formatIntakeAnswer, humanizeProfileKey, labelForProfileKey } from './intake-vocabulary'
import type { ProjectIntakeQuestion } from './intake-types'
import { formatBareValue } from './brief-view'
import { normalizeProfilePatchOperation } from './legacy-names'
import type { ProjectPrimitiveValue, ProjectProfile, ProjectProfilePatchOperation } from './types'

export interface PatchPreviewRow {
  label: string
  before: string
  after: string
}

type PatchSection = 'facts' | 'assumptions' | 'goals' | 'unknowns'

export function buildPatchPreviewRows(
  patch: ProjectProfilePatchOperation[],
  profile: ProjectProfile | null
): PatchPreviewRow[] {
  const rows: PatchPreviewRow[] = []

  for (const legacyOp of patch) {
    const op = normalizeProfilePatchOperation(legacyOp)
    const target = extractTarget(op.path)
    if (!target) continue

    if (target.section === 'unknowns') {
      const key = String(op.value ?? '')
      const label = humanizeProfileKey(key)
      rows.push({
        label,
        before: profile === null ? '' : '—',
        after: op.op === 'remove' ? '—' : label,
      })
      continue
    }

    const { section, key } = target
    const label =
      section === 'goals'
        ? humanizeProfileKey(key)
        : labelForProfileKey(projectIntakeDefinitionV1, key)
    const after = op.op === 'remove' ? '—' : formatAfter(key, op.value)
    const before = formatBefore(profile, section, key)
    rows.push({ label, before, after })
  }

  return rows
}

function extractTarget(
  path: string
):
  | { section: Exclude<PatchSection, 'unknowns'>; key: string }
  | { section: 'unknowns'; key: string }
  | null {
  const parts = path.split('/')
  const section = parts[1]

  if (section === 'unknowns') {
    if (parts[2] === '-') return { section: 'unknowns', key: '' }
    return null
  }

  if (section === 'facts' || section === 'assumptions') {
    if (parts.length === 3 && parts[2] && parts[2] !== '-')
      return { section, key: decodeSegment(parts[2]) }
    if (parts.length === 4 && parts[3] === 'value' && parts[2] && parts[2] !== '-') {
      return { section, key: decodeSegment(parts[2]) }
    }
    return null
  }

  if (section === 'goals') {
    if (parts.length === 3 && parts[2] && parts[2] !== '-')
      return { section, key: decodeSegment(parts[2]) }
    return null
  }

  return null
}

function formatAfter(key: string, raw: unknown): string {
  let value: unknown = raw
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    if ('value' in raw) value = (raw as Record<string, unknown>).value
    else return JSON.stringify(raw)
  }
  return formatValue(key, value)
}

function formatBefore(
  profile: ProjectProfile | null,
  section: Exclude<PatchSection, 'unknowns'>,
  key: string
): string {
  if (profile === null) return ''
  let raw: ProjectPrimitiveValue | undefined
  if (section === 'facts') raw = profile.facts[key]?.value
  else if (section === 'assumptions') raw = profile.assumptions[key]?.value
  else raw = profile.goals[key]
  if (raw === undefined) return '—'
  return formatValue(key, raw)
}

function formatValue(key: string, value: unknown): string {
  const question = questionForKey(key)
  if (question) return formatIntakeAnswer(question, value as ProjectPrimitiveValue | undefined)
  return formatBareValue(value as ProjectPrimitiveValue)
}

function questionForKey(key: string): ProjectIntakeQuestion | undefined {
  return flattenIntakeQuestions(projectIntakeDefinitionV1).find((question) => {
    const match = question.writesTo?.match(/^\/(?:facts|goals|assumptions)\/([^/]+)/)
    return match?.[1] === key
  })
}

function decodeSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}
