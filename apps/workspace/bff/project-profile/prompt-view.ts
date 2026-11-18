import { findProjectProfile, findProjectProfileInOrg, findProjectPromptView } from '@/lib/projects/repository'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { profileAsTheLawShows } from '@/lib/project-intake/derivation-view'
import { projectIntakeDefinitionV1 } from './intake-definition'
import { loadDocumentRolesPromptSection } from '@/lib/document-roles/prompt-loader'
import { loadUnreadableDocumentsSection } from './unreadable-section'
import { getCached, invalidateCached } from '@/lib/cache'
import { buildProjectBriefView } from './brief-view'
import { normalizeLegacyProfile, normalizeLegacyPromptView } from './legacy-names'
import { isValidFederalStateToken } from './intake-conditions'
import { ProjectProfileSchema } from './types'
import type {
  ProjectAssumption,
  ProjectFact,
  ProjectPrimitiveValue,
  ProjectProfile,
  ProjectProfileDisplay,
} from './types'

export { applyProjectProfilePatch, emptyProjectProfile } from './patch-engine'

const PROMPT_VIEW_CACHE_TTL_MS = 5 * 60 * 1000

const ANONYMOUS_TENANT = 'anon'

const promptViewCacheKey = (projectId: string, organizationId: string | null | undefined) =>
  `promptview-v2:${organizationId ?? ANONYMOUS_TENANT}:${projectId}`
const federalStateCacheKey = (projectId: string, organizationId: string | null | undefined) =>
  `federal-state:${organizationId ?? ANONYMOUS_TENANT}:${projectId}`

export async function loadProjectPromptView(
  projectId: string | undefined,
  organizationId: string | null | undefined
): Promise<string | null> {
  if (!projectId) return null

  const build = async (): Promise<string | null> => {
    const [stored, documents] = await Promise.all([
      storedViewAsTheLawShows(projectId, organizationId),
      loadDocumentRolesPromptSection(projectId, organizationId),
    ])
    const combined = [stored ? normalizeLegacyPromptView(stored).trim() : null, documents]
      .filter(Boolean)
      .join('\n\n')
      .trim()
    return combined || null
  }

  const [view, unreadable] = await Promise.all([
    getCached(promptViewCacheKey(projectId, organizationId), PROMPT_VIEW_CACHE_TTL_MS, build),
    loadUnreadableDocumentsSection(projectId, organizationId),
  ])
  return [view, unreadable].filter(Boolean).join('\n\n') || null
}

async function storedViewAsTheLawShows(projectId: string, organizationId: string | null | undefined): Promise<string | null> {
  const stored = await findProjectPromptView(projectId, organizationId)
  if (!organizationId || !stored) return stored
  const [{ gate }, state] = await Promise.all([contextForPage(organizationId, projectId), findProjectProfileInOrg(projectId, organizationId)])
  if (!state) return stored
  const profile = normalizeLegacyProfile(state.profile) as ProjectProfile
  const shown = profileAsTheLawShows(profile, projectIntakeDefinitionV1, gate.state)
  return shown === profile ? stored : buildProjectPromptView(shown)
}

export async function invalidateProjectPromptViewCache(
  projectId: string,
  organizationId: string | null | undefined
): Promise<void> {
  await Promise.all(
    tenantVariants(promptViewCacheKey, projectId, organizationId).map((key) =>
      invalidateCached(key)
    )
  )
}

function tenantVariants(
  key: (projectId: string, organizationId: string | null | undefined) => string,
  projectId: string,
  organizationId: string | null | undefined
): string[] {
  const keys = new Set([key(projectId, organizationId), key(projectId, null)])
  return [...keys]
}

export async function invalidateProjectProfileCaches(
  projectId: string,
  organizationId: string | null | undefined
): Promise<void> {
  await Promise.all(
    [
      ...tenantVariants(promptViewCacheKey, projectId, organizationId),
      ...tenantVariants(federalStateCacheKey, projectId, organizationId),
    ].map((key) => invalidateCached(key))
  )
}

export async function loadProjectFederalState(
  projectId: string | undefined,
  organizationId: string | null | undefined
): Promise<string | null> {
  if (!projectId) return null

  return getCached(
    federalStateCacheKey(projectId, organizationId),
    PROMPT_VIEW_CACHE_TTL_MS,
    async () => {
      const profile = await findProjectProfile(projectId, organizationId)
      const value = profile?.facts?.federal_state?.value
      return typeof value === 'string' && isValidFederalStateToken(value) ? value : null
    }
  )
}

export function buildProjectPromptView(profile: ProjectProfile): string {
  const normalized = ProjectProfileSchema.parse(profile)
  const sections: string[][] = [['PROJECT_CONTEXT v1']]

  const factKeys = Object.keys(normalized.facts).sort()

  const countryInFacts = normalized.facts.country
  if (!countryInFacts && normalized.facts.federal_state?.value) {
    const bv = normalized.facts.federal_state.value
    if (typeof bv === 'string' && bv !== 'outside_austria' && isValidFederalStateToken(bv)) {
      factKeys.unshift('country')
      normalized.facts.country = {
        value: 'at',
        confidence: 'confirmed',
        source: 'onboarding',
        updatedAt: '',
      }
    }
  }

  if (factKeys.length > 0) {
    sections.push([
      'confirmed:',
      ...factKeys.map(
        (key) => `- ${formatPromptToken(key)}=${formatPromptValue(normalized.facts[key].value)}`
      ),
    ])
  }

  const goalKeys = Object.keys(normalized.goals).sort()
  if (goalKeys.length > 0) {
    sections.push([
      'goals:',
      ...goalKeys.map(
        (key) => `- ${formatPromptToken(key)}=${formatPromptValue(normalized.goals[key])}`
      ),
    ])
  }

  const unknowns = [...normalized.unknowns].sort()
  if (unknowns.length > 0) {
    sections.push(['unknown:', ...unknowns.map((unknown) => `- ${formatPromptToken(unknown)}`)])
  }

  const assumptionKeys = Object.keys(normalized.assumptions).sort()
  if (assumptionKeys.length > 0) {
    sections.push([
      'assumptions:',
      ...bounded(
        assumptionKeys.map((key) => {
          const assumption = normalized.assumptions[key]
          return `- ${formatPromptToken(key)}=${formatPromptValue(assumption.value)}${provenanceSuffix(assumption.evidence)}`
        })
      ),
    ])
  }

  const contested = contestedLines(normalized)
  if (contested.length > 0) sections.push(['contested:', ...bounded(contested)])

  return sections.map((section) => section.join('\n')).join('\n\n')
}

const MAX_VIEW_LINES = 60

const MAX_VIEW_FILE_NAME_LENGTH = 120

function bounded(lines: string[]): string[] {
  if (lines.length <= MAX_VIEW_LINES) return lines
  return [...lines.slice(0, MAX_VIEW_LINES), `- … und ${lines.length - MAX_VIEW_LINES} weitere`]
}

function documentSource(evidence: ProjectFact['evidence']): string | null {
  const document = evidence?.find((entry) => entry.kind === 'document')
  if (document?.kind !== 'document') return null
  const name = formatPromptToken(document.fileName.slice(0, MAX_VIEW_FILE_NAME_LENGTH))
  return document.page === null ? name : `${name}, S. ${document.page}`
}

function provenanceSuffix(evidence: ProjectAssumption['evidence']): string {
  const source = documentSource(evidence)
  if (source) return ` [Vorschlag: ${source}]`
  return evidence?.some((entry) => entry.kind === 'derivation') ? ' [abgeleitet]' : ''
}

function contestedLines(profile: ProjectProfile): string[] {
  const entries = [
    ...Object.entries(profile.facts).map(([key, fact]) => ({ key, ...fact })),
    ...Object.entries(profile.assumptions).map(([key, assumption]) => ({ key, ...assumption })),
  ]
  return entries
    .filter((entry) => (entry.alternatives?.length ?? 0) > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => {
      const alternatives = (entry.alternatives ?? []).map((alternative) => {
        const source = documentSource(alternative.evidence)
        return ` | alternativ: ${formatPromptValue(alternative.value)}${source ? ` (${source})` : ''}`
      })
      return `- ${formatPromptToken(entry.key)}: ${formatPromptValue(entry.value)}${alternatives.join('')}`
    })
}

export function buildProjectProfileDisplay(
  profile: ProjectProfile,
  previousSummary = '',
  previousSummaryLocale?: string
): ProjectProfileDisplay {
  const normalized = ProjectProfileSchema.parse(profile)
  const brief = buildProjectBriefView(normalized)

  return {
    title: 'Project profile',
    summary: previousSummary,
    summaryLocale: previousSummaryLocale,
    keyFacts: brief.groups.flatMap((group) =>
      group.facts.map((fact) => ({ label: fact.label, value: fact.value }))
    ),
    missingInfo: brief.missing.map((item) => item.label),
  }
}

function formatPromptToken(value: string): string {
  return isSafePromptToken(value)
    ? value
    : JSON.stringify(value).replace(/[\u0080-\u009f\u2028\u2029]/g, escapeLineSeparator)
}

function formatPromptValue(value: ProjectPrimitiveValue): string {
  if (typeof value === 'string') {
    return formatPromptToken(value)
  }

  return String(value)
}

function isSafePromptToken(value: string): boolean {
  return !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)
}

function escapeLineSeparator(value: string): string {
  return `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`
}
