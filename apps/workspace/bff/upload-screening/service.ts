import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import { filedInOf } from '@/lib/audit/document-names'
import { getCached, invalidateCached } from '@/lib/cache'
import { getOrgSettings, writeDedicatedOrgSetting } from '@/lib/organizations/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { buildContentRules, chatScreeningRules, maskText, type MaskedText } from './content-screen'
import { screenUploadName, type NameMatch, type ScreenedName } from './name-screen'
import { applyProjectOverride, type ProjectScreeningOverride } from './project-policy'
import { findProjectScreeningOverride } from './project-repository'
import {
  SUGGESTED_SCREENING_POLICY,
  resolveUploadScreeningPolicy,
  toChatScreening,
  toIngestScreening,
  type ChatScreening,
  type IngestScreening,
  type UploadScreeningPolicy,
} from './policy'

export const UPLOAD_SCREENING_SETTING = 'uploadScreening'

const POLICY_CACHE_TTL_MS = 30_000
const policyCacheKey = (organizationId: string): string => `upload-screening:${organizationId}`

const projectOverrideCacheKey = (organizationId: string, projectId: string): string =>
  `upload-screening:${organizationId}:project:${projectId}`

export async function getUploadScreeningPolicy(organizationId: string): Promise<UploadScreeningPolicy> {
  return getCached(policyCacheKey(organizationId), POLICY_CACHE_TTL_MS, async () => {
    const { settings } = await getOrgSettings(organizationId)
    return resolveUploadScreeningPolicy(settings[UPLOAD_SCREENING_SETTING])
  })
}

export async function getProjectScreeningOverride(
  organizationId: string,
  projectId: string
): Promise<ProjectScreeningOverride | null> {
  return getCached(projectOverrideCacheKey(organizationId, projectId), POLICY_CACHE_TTL_MS, () =>
    findProjectScreeningOverride(organizationId, projectId)
  )
}

export async function forgetProjectScreeningOverride(organizationId: string, projectId: string): Promise<void> {
  await invalidateCached(projectOverrideCacheKey(organizationId, projectId))
}

export async function getProjectUploadScreeningPolicy(
  organizationId: string,
  projectId: string
): Promise<UploadScreeningPolicy> {
  const [office, override] = await Promise.all([
    getUploadScreeningPolicy(organizationId),
    getProjectScreeningOverride(organizationId, projectId),
  ])
  return applyProjectOverride(office, override)
}

async function policyOrSuggestion(organizationId: string): Promise<UploadScreeningPolicy> {
  try {
    return await getUploadScreeningPolicy(organizationId)
  } catch (error) {
    console.error('[upload-screening] policy unreadable, screening with the suggested list:', error)
    return SUGGESTED_SCREENING_POLICY
  }
}

export async function hasSavedUploadScreeningPolicy(organizationId: string): Promise<boolean> {
  const { settings } = await getOrgSettings(organizationId)
  return settings[UPLOAD_SCREENING_SETTING] !== undefined && settings[UPLOAD_SCREENING_SETTING] !== null
}

export async function saveUploadScreeningPolicy(
  session: AuthorizedSession,
  policy: UploadScreeningPolicy,
  request: Request
): Promise<UploadScreeningPolicy> {
  await writeDedicatedOrgSetting(session.organizationId, UPLOAD_SCREENING_SETTING, policy)
  await invalidateCached(policyCacheKey(session.organizationId))
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.upload_screening.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: {
      enabled: String(policy.enabled),
      nameTerms: policy.nameTerms.length,
      nameExceptions: policy.nameExceptions.length,
      contentTerms: policy.contentTerms.length,
      detectors: policy.detectors.join(','),
    },
    request,
  })
  return policy
}

export class ScreenedUploadError extends ApiError {
  constructor(readonly matches: NameMatch[]) {
    super(422, 'UPLOAD_SCREENED', 'This file is excluded by the organization’s upload screening', { matches })
  }
}

export class ScreeningPolicyUnavailableError extends ApiError {
  constructor() {
    super(503, 'UPLOAD_SCREENING_UNAVAILABLE', 'The organization’s upload screening could not be read; nothing was stored')
  }
}

export async function gatePolicy(organizationId: string, projectId?: string | null): Promise<UploadScreeningPolicy> {
  try {
    return projectId
      ? await getProjectUploadScreeningPolicy(organizationId, projectId)
      : await getUploadScreeningPolicy(organizationId)
  } catch (error) {
    console.error('[upload-screening] policy unreadable, refusing the upload:', error)
    throw new ScreeningPolicyUnavailableError()
  }
}

export interface NameGateResult {
  overridden: NameMatch[]
}

export async function assertUploadNameAllowed(
  organizationId: string,
  name: ScreenedName,
  released: boolean,
  projectId?: string | null
): Promise<NameGateResult> {
  const policy = await gatePolicy(organizationId, projectId)
  const verdict = screenUploadName(policy, name)
  if (!verdict.blocked) return { overridden: [] }
  if (!released) throw new ScreenedUploadError(verdict.matches)
  return { overridden: verdict.matches }
}

export async function auditScreeningOverride(
  session: AuthorizedSession,
  input: { documentId: string; projectId: string | null; folderId: string | null; filename: string; overridden: NameMatch[] },
  request: Request
): Promise<void> {
  if (input.overridden.length === 0) return
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.screening_overridden',
    targetType: 'document',
    targetId: input.documentId,
    filedIn: filedInOf(input),
    metadata: {
      projectId: input.projectId ?? '',
      filename: input.filename.slice(0, 200),
      terms: [...new Set(input.overridden.map((match) => match.term))].join(',').slice(0, 200),
    },
    request,
  })
}

export function readScreeningRelease(value: FormDataEntryValue | null): boolean {
  return value === 'name'
}

export async function ingestScreeningFor(
  organizationId: string,
  row: { contentHash: string | null; screeningReleasedHash: string | null } | null
): Promise<IngestScreening | null> {
  const policy = await gatePolicy(organizationId)
  const released = Boolean(row?.contentHash && row.screeningReleasedHash === row.contentHash)
  return toIngestScreening(policy, { released })
}

export async function chatScreeningFor(organizationId: string): Promise<ChatScreening> {
  return toChatScreening(await policyOrSuggestion(organizationId))
}

export async function maskChatText(organizationId: string, text: string): Promise<MaskedText> {
  return maskText(text, chatScreeningRules(await policyOrSuggestion(organizationId)))
}

export async function maskAnswerText(organizationId: string, text: string): Promise<MaskedText> {
  const policy = await policyOrSuggestion(organizationId)
  return maskText(text, policy.enabled ? buildContentRules([], policy.detectors) : null)
}
