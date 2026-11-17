import { BUILDING_ID_IN_KEY, buildingTag } from './intake-building-keys'
import { flattenIntakeQuestions } from './intake-conditions'
import { projectIntakeDefinitionV1 } from './intake-definition'
import { formatIntakeAnswer } from './intake-vocabulary'
import type { ProjectIntakeQuestion } from './intake-types'
import { ProjectProfileSchema } from './types'
import type { ProjectAssumption, ProjectFact, ProjectProfile } from './types'

export interface BriefFact {
  key: string
  label: string
  value: string
  source: ProjectFact['source']
  updatedAt: string
}

export interface BriefFactGroup {
  id: string
  title: string
  facts: BriefFact[]
}

export interface BriefAssumption {
  key: string
  label: string
  value: string
  rawValue: ProjectAssumption['value']
  reason: string
  source: ProjectAssumption['source']
}

export interface BriefMissingFact {
  key: string
  label: string
}

export interface ProjectBriefView {
  groups: BriefFactGroup[]
  focusAreas: string[]
  goalDetails: string | null
  missing: BriefMissingFact[]
  assumptions: BriefAssumption[]
  answeredCount: number
  totalCount: number
}

const HIDDEN_FACT_KEYS = new Set(['project_name'])

function isHiddenFactKey(key: string): boolean {
  return HIDDEN_FACT_KEYS.has(key) || key.startsWith('building_name@')
}

function baseKeyOf(key: string): string {
  return key.split('@')[0]
}

function humanizeKey(key: string): string {
  const label = baseKeyOf(key).replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function questionByFactKey(): Map<string, { question: ProjectIntakeQuestion; stageId: string }> {
  const map = new Map<string, { question: ProjectIntakeQuestion; stageId: string }>()
  for (const stage of projectIntakeDefinitionV1.stages) {
    for (const question of stage.questions) {
      const match = question.writesTo?.match(/^\/facts\/([^/]+)/)
      if (match) map.set(match[1], { question, stageId: stage.id })
    }
  }
  return map
}

export function buildProjectBriefView(rawProfile: unknown): ProjectBriefView {
  const parsed = ProjectProfileSchema.safeParse(rawProfile ?? {})
  const profile: ProjectProfile = parsed.success ? parsed.data : ProjectProfileSchema.parse({})
  const byKey = questionByFactKey()

  const groups: BriefFactGroup[] = projectIntakeDefinitionV1.stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    facts: [],
  }))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const other: BriefFactGroup = { id: 'other', title: 'Additional context', facts: [] }

  const factKeys = Object.keys(profile.facts)
  const orderedBaseKeys = flattenIntakeQuestions(projectIntakeDefinitionV1)
    .map((question) => question.writesTo?.match(/^\/facts\/([^/]+)/)?.[1])
    .filter((key): key is string => Boolean(key))
  const rank = new Map(orderedBaseKeys.map((key, i) => [key, i]))
  const orderedKeys = [...factKeys].sort((a, b) => {
    const ra = rank.get(baseKeyOf(a)) ?? Infinity
    const rb = rank.get(baseKeyOf(b)) ?? Infinity
    return ra === rb ? a.localeCompare(b) : ra - rb
  })

  const scopeSuffix = (key: string): string => {
    const m = key.match(BUILDING_ID_IN_KEY)
    if (!m) return ''
    const name = profile.facts[`building_name@${m[1]}`]?.value
    return typeof name === 'string' && name ? ` · ${name}` : ` · ${buildingTag(m[1])}`
  }

  for (const key of orderedKeys) {
    if (isHiddenFactKey(key)) continue
    const fact = profile.facts[key]
    const entry = byKey.get(baseKeyOf(key))
    const suffix = key.includes('@') ? scopeSuffix(key) : ''
    const view: BriefFact = {
      key,
      label: (entry?.question.label ?? humanizeKey(key)) + suffix,
      value: entry ? formatIntakeAnswer(entry.question, fact.value) : formatBareValue(fact.value),
      source: fact.source,
      updatedAt: fact.updatedAt,
    }
    ;(entry ? groupById.get(entry.stageId)! : other).facts.push(view)
  }

  const focusQuestion = flattenIntakeQuestions(projectIntakeDefinitionV1).find(
    (q) => q.id === 'focus_areas'
  )
  const rawFocus = profile.goals['focus_areas']
  const focusValues = Array.isArray(rawFocus)
    ? rawFocus
    : typeof rawFocus === 'string'
      ? [rawFocus]
      : []
  const focusAreas = focusValues.map(
    (value) => focusQuestion?.options?.find((option) => option.value === value)?.label ?? value
  )
  const goalDetails =
    typeof profile.goals['goal_details'] === 'string' ? profile.goals['goal_details'] : null

  const missing: BriefMissingFact[] = [...new Set(profile.unknowns)]
    .filter((key) => !(key in profile.facts))
    .map((key) => ({ key, label: byKey.get(baseKeyOf(key))?.question.label ?? humanizeKey(key) }))

  const assumptions: BriefAssumption[] = Object.entries(profile.assumptions).map(
    ([key, assumption]) => {
      const entry = byKey.get(baseKeyOf(key))
      return {
        key,
        label: entry?.question.label ?? humanizeKey(key),
        value: entry
          ? formatIntakeAnswer(entry.question, assumption.value)
          : formatBareValue(assumption.value),
        rawValue: assumption.value,
        reason: assumption.reason,
        source: assumption.source,
      }
    }
  )

  const answeredCount = groups.reduce((n, group) => n + group.facts.length, 0) + other.facts.length
  return {
    groups: [...groups, other].filter((group) => group.facts.length > 0),
    focusAreas,
    goalDetails,
    missing,
    assumptions,
    answeredCount,
    totalCount: answeredCount + missing.length,
  }
}

export function buildProjectSummaryText(rawProfile: unknown): string {
  const parsed = ProjectProfileSchema.safeParse(rawProfile ?? {})
  const profile: ProjectProfile = parsed.success ? parsed.data : ProjectProfileSchema.parse({})
  const brief = buildProjectBriefView(profile)

  const lines: string[] = []
  const name = profile.facts['project_name']?.value
  if (typeof name === 'string' && name.trim()) lines.push(`Project name: ${name.trim()}`)
  if (brief.focusAreas.length > 0) lines.push(`Focus: ${brief.focusAreas.join('; ')}`)
  if (brief.goalDetails) lines.push(`Focus details: ${brief.goalDetails}`)
  for (const group of brief.groups) {
    for (const fact of group.facts) {
      lines.push(`${fact.label}: ${fact.value}`)
    }
  }
  return lines.join('\n')
}

export function formatBareValue(value: ProjectFact['value']): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
