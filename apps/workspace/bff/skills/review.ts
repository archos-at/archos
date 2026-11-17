import 'server-only'

import { getBackendUrl } from '@/lib/backend-proxy'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'

const REVIEW_TIMEOUT_MS = 20_000

export const SKILL_FINDING_SEVERITIES = ['error', 'warning', 'suggestion'] as const
export type SkillFindingSeverity = (typeof SKILL_FINDING_SEVERITIES)[number]

export const SKILL_FINDING_FIELDS = ['name', 'description', 'body'] as const
export type SkillFindingField = (typeof SKILL_FINDING_FIELDS)[number]

export interface SkillReviewFinding {
  severity: SkillFindingSeverity
  field: SkillFindingField
  message: string
  fix: string
  check: string
}

export interface SkillReviewResult {
  findings: SkillReviewFinding[] | null
  error?: string
}

export interface SkillReviewInput {
  name: string
  description: string
  body: string
}

const MAX_FINDINGS = 12
const MAX_TEXT = 400
const MAX_CHECK = 64

function toFinding(raw: unknown): SkillReviewFinding | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const severity = entry.severity
  const field = entry.field
  const message = entry.message
  const fix = entry.fix
  if (!SKILL_FINDING_SEVERITIES.includes(severity as SkillFindingSeverity)) return null
  if (!SKILL_FINDING_FIELDS.includes(field as SkillFindingField)) return null
  if (typeof message !== 'string' || !message.trim()) return null
  const check = typeof entry.check === 'string' ? entry.check.trim() : ''
  return {
    severity: severity as SkillFindingSeverity,
    field: field as SkillFindingField,
    message: message.trim().slice(0, MAX_TEXT),
    fix: typeof fix === 'string' ? fix.trim().slice(0, MAX_TEXT) : '',
    check: check.length <= MAX_CHECK ? check : '',
  }
}

export async function reviewSkill(
  session: AuthorizedSession,
  input: SkillReviewInput,
): Promise<SkillReviewResult> {
  if (requireSkillsEnabled(session)) {
    throw new ForbiddenError('Agent Skills is disabled.')
  }

  try {
    const response = await fetch(`${getBackendUrl()}/v1/skills/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': session.organizationId,
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        body: input.body,
        organization_id: session.organizationId,
      }),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.warn('[SkillReview] Backend error (non-fatal):', response.status, detail)
      return { findings: null, error: 'review_failed' }
    }

    const payload = (await response.json()) as {
      findings?: unknown
      error?: string | null
    }
    if (!Array.isArray(payload.findings)) {
      return { findings: null, error: payload.error ?? 'review_unavailable' }
    }
    return {
      findings: payload.findings
        .map(toFinding)
        .filter((finding): finding is SkillReviewFinding => finding !== null)
        .slice(0, MAX_FINDINGS),
      error: payload.error ?? undefined,
    }
  } catch (error) {
    console.warn('[SkillReview] Request failed (non-fatal):', error)
    return { findings: null, error: 'review_request_failed' }
  }
}
