import 'server-only'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { profileAsTheLawShows } from '@/lib/project-intake/derivation-view'

const PROFILE_WRITE: readonly ProjectPermission[] = ['project:memory:write', 'project:edit']
import { getBackendUrl } from '@/lib/backend-proxy'
import { deleteBindingsOutsideBuildings } from '@/lib/document-roles/repository'
import { buildingIds } from '@/lib/document-roles/service'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Locale } from '@/i18n/config'
import { requireMayLeaveConversation } from '@/lib/conversations/restricted-egress'
import { requireResourceAccess } from '@/lib/sharing/access'
import {
  findProjectProfileInOrg,
  setProjectProfileSummaryInOrg,
  updateProjectProfileIfVersion,
  type ProjectProfileState,
} from '@/lib/projects/repository'
import {
  applyProjectProfilePatch,
  buildProjectProfileDisplay,
  buildProjectPromptView,
  invalidateProjectProfileCaches,
} from './prompt-view'
import { buildProjectSummaryText } from './brief-view'
import { REGISTER_EVIDENCE_REFUSAL, addsRegisterEvidence } from './register-evidence'
import { syncProjectFacts } from '@/lib/cross-project/project-facts-mirror'
import {
  isPatchAlreadyApplied,
  normalizeProfilePatchOperations,
  pruneResolvedAssumptions,
  pruneResolvedUnknowns,
} from './patch-engine'
import { projectIntakeDefinitionV1 } from './intake-definition'
import type { ProjectIntakeDefinition } from './intake-types'
import { validateProfilePatchVocabulary } from './intake-vocabulary'
import type { AiConsistencyFinding, ConsistencyCheckField } from './intake-consistency'
import { normalizeLegacyProfile } from './legacy-names'
import type { ProjectProfile, ProjectProfilePatchOperation } from './types'

const CONSISTENCY_CHECK_TIMEOUT_MS = 10_000
const GENERATE_SUMMARY_TIMEOUT_MS = 35_000

export async function getProjectProfile(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectProfileState> {
  await requireProjectAccess(session, projectId, 'project:view')
  const [state, context] = await Promise.all([
    findProjectProfileInOrg(projectId, session.organizationId),
    contextForPage(session.organizationId, projectId),
  ])
  if (!state) throw new NotFoundError()
  const profile = profileAsTheLawShows(state.profile, projectIntakeDefinitionV1, context.gate.state)
  return profile === state.profile ? state : { ...state, profile }
}

export async function saveProjectProfile(
  session: AuthorizedSession,
  projectId: string,
  profile: ProjectProfile,
  expectedVersion?: number
): Promise<ProjectProfileState> {
  await requireProjectAccess(session, projectId, PROFILE_WRITE)
  const current = await findProjectProfileInOrg(projectId, session.organizationId)
  if (!current) throw new NotFoundError()
  if (expectedVersion !== undefined && current.profileVersion !== expectedVersion) {
    throw new ConflictError('Conflict: profile was modified since it was loaded')
  }
  const named = normalizeLegacyProfile(profile) as ProjectProfile
  if (addsRegisterEvidence(normalizeLegacyProfile(current.profile) as ProjectProfile, named))
    throw new BadRequestError(REGISTER_EVIDENCE_REFUSAL)
  return persistProfile(projectId, session.organizationId, named, current, {
    resetSummary: true,
    inTransaction: (tx, saved) =>
      deleteBindingsOutsideBuildings(projectId, buildingIds(saved.profile), tx).then(() => undefined),
  })
}

export interface PatchedProjectProfile extends ProjectProfileState {
  alreadyApplied?: boolean
}

export interface ProfilePatchOrigin {
  conversationId: string
  locale: Locale
}

export async function patchProjectProfile(
  session: AuthorizedSession,
  projectId: string,
  operations: ProjectProfilePatchOperation[],
  origin?: ProfilePatchOrigin,
  options?: { registerEvidence?: true }
): Promise<PatchedProjectProfile> {
  await requireProjectAccess(session, projectId, PROFILE_WRITE)
  if (origin) {
    await requireResourceAccess(session, 'conversation', origin.conversationId, 'viewer')
    await requireMayLeaveConversation(
      { conversationId: origin.conversationId, locale: origin.locale },
      session.organizationId,
      'profilePatch'
    )
  }
  const current = await findProjectProfileInOrg(projectId, session.organizationId)
  if (!current) throw new NotFoundError()

  let normalized: ProjectProfilePatchOperation[]
  let profile: ProjectProfile
  try {
    validateProfilePatchVocabulary(operations)
    normalized = normalizeProfilePatchOperations(operations)
    const stored = normalizeLegacyProfile(current.profile) as ProjectProfile
    profile = pruneResolvedUnknowns(applyProjectProfilePatch(stored, normalized))
    if (!options?.registerEvidence && addsRegisterEvidence(stored, profile)) throw new Error(REGISTER_EVIDENCE_REFUSAL)
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : 'Invalid project profile patch.'
    )
  }

  try {
    return await persistProfile(projectId, session.organizationId, profile, current)
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error
    const fresh = await findProjectProfileInOrg(projectId, session.organizationId)
    if (!fresh || !isPatchAlreadyApplied(fresh.profile, normalized)) throw error
    return { ...fresh, alreadyApplied: true }
  }
}

export async function seedProjectProfile(
  project: ProjectProfileState & { id: string; organizationId: string },
  profile: ProjectProfile,
  inTransaction?: Parameters<typeof updateProjectProfileIfVersion>[4]
): Promise<ProjectProfileState> {
  return persistProfile(project.id, project.organizationId, profile, project, { inTransaction })
}

async function persistProfile(
  projectId: string,
  organizationId: string,
  rawProfile: ProjectProfile,
  current: ProjectProfileState,
  options?: {
    resetSummary?: boolean
    inTransaction?: Parameters<typeof updateProjectProfileIfVersion>[4]
  }
): Promise<ProjectProfileState> {
  const profile = pruneResolvedAssumptions(rawProfile)
  const updated = await updateProjectProfileIfVersion(
    projectId,
    organizationId,
    current.profileVersion,
    {
      profile,
      profileVersion: current.profileVersion + 1,
      profilePromptView: buildProjectPromptView(profile),
      profileDisplay: buildProjectProfileDisplay(
        profile,
        options?.resetSummary ? '' : (current.profileDisplay?.summary ?? ''),
        options?.resetSummary ? undefined : current.profileDisplay?.summaryLocale
      ),
      profileUpdatedAt: new Date(),
    },
    options?.inTransaction
  )
  if (!updated) throw new ConflictError('Conflict: profile was modified by another request')

  await invalidateProjectProfileCaches(projectId, organizationId)
  await syncProjectFacts(organizationId, projectId)
  return updated
}

export async function getProjectIntakeDefinition(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectIntakeDefinition> {
  await requireProjectAccess(session, projectId, 'project:view')
  return projectIntakeDefinitionV1
}

interface BackendConsistencyFinding {
  fields?: unknown
  severity?: unknown
  explanation?: unknown
}

function toAiFinding(raw: BackendConsistencyFinding): AiConsistencyFinding | null {
  const message = typeof raw.explanation === 'string' ? raw.explanation.trim() : ''
  if (!message) return null
  const severity: AiConsistencyFinding['severity'] =
    raw.severity === 'inconsistency' ? 'inconsistency' : 'warning'
  const fields = Array.isArray(raw.fields)
    ? raw.fields.filter((f): f is string => typeof f === 'string')
    : []
  return { kind: 'ai', fields, severity, message }
}

export async function checkProjectConsistency(
  session: AuthorizedSession,
  projectId: string,
  input: {
    freeText: ConsistencyCheckField[]
    structured?: ConsistencyCheckField[]
    locale?: string
  }
): Promise<{ findings: AiConsistencyFinding[] | null; error?: string }> {
  await requireProjectAccess(session, projectId, PROFILE_WRITE)

  try {
    const backendRes = await fetch(`${getBackendUrl()}/v1/consistency-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': session.organizationId,
      },
      body: JSON.stringify({
        free_text: input.freeText,
        structured: input.structured ?? [],
        locale: input.locale ?? 'de',
      }),
      signal: AbortSignal.timeout(CONSISTENCY_CHECK_TIMEOUT_MS),
    })

    if (!backendRes.ok) {
      const errorText = await backendRes.text().catch(() => '')
      console.warn('[ConsistencyCheck] Backend error (non-fatal):', backendRes.status, errorText)
      return { findings: null, error: 'check_failed' }
    }

    const { findings, error } = (await backendRes.json()) as {
      findings: BackendConsistencyFinding[] | null
      error?: string | null
    }
    if (findings == null) return { findings: null, error: error ?? undefined }
    return {
      findings: findings.map(toAiFinding).filter((f): f is AiConsistencyFinding => f !== null),
      error: error ?? undefined,
    }
  } catch (e) {
    console.warn('[ConsistencyCheck] Request failed (non-fatal):', e)
    return { findings: null, error: 'check_request_failed' }
  }
}

export async function generateProjectSummary(
  session: AuthorizedSession,
  projectId: string,
  options?: { locale?: string }
): Promise<{ summary: string; error?: string }> {
  await requireProjectAccess(session, projectId, PROFILE_WRITE)

  const state = await findProjectProfileInOrg(projectId, session.organizationId)
  if (!state) throw new NotFoundError()

  const profileText = buildProjectSummaryText(state.profile)
  if (!profileText) {
    return { summary: '' }
  }

  const locale = options?.locale ?? 'de'

  let backendRes: Response
  try {
    backendRes = await fetch(`${getBackendUrl()}/v1/generate-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': session.organizationId,
      },
      body: JSON.stringify({ profile_text: profileText, locale }),
      signal: AbortSignal.timeout(GENERATE_SUMMARY_TIMEOUT_MS),
    })
  } catch (e) {
    console.error('[GenerateSummary] Backend unreachable (non-fatal):', e)
    return { summary: '', error: 'backend_unreachable' }
  }

  if (!backendRes.ok) {
    const errorText = await backendRes.text().catch(() => '')
    console.error('[GenerateSummary] Backend error:', backendRes.status, errorText)
    return { summary: '', error: 'backend_error' }
  }

  const { summary, error } = (await backendRes.json()) as { summary: string; error?: string | null }

  if (error) {
    console.error('[GenerateSummary] Generation failed:', error)
    return { summary: '', error }
  }

  if (summary) {
    await setProjectProfileSummaryInOrg(projectId, session.organizationId, summary, locale)
  }

  return { summary }
}
