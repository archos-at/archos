import 'server-only'
import { z } from 'zod'
import { getCached, invalidateCached } from '@/lib/cache'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  deleteOrganizationInstructions,
  findOrganizationInstructions,
  upsertOrganizationInstructions,
} from './repository'

export interface OrgInstructions {
  instructions: string | null
  updatedBy: string | null
  updatedByEmail: string | null
  updatedAt: string | null
}

const EMPTY: OrgInstructions = {
  instructions: null,
  updatedBy: null,
  updatedByEmail: null,
  updatedAt: null,
}

import { orgInstructionsSchema } from '@/lib/organizations/organization-wire'

export { orgInstructionsSchema }

export type OrgInstructionsInput = z.infer<typeof orgInstructionsSchema>

const INSTRUCTIONS_CACHE_TTL_MS = 30_000

const instructionsCacheKey = (organizationId: string): string => `orginstructions:${organizationId}`

export async function resolveOrgInstructions(
  organizationId: string | null | undefined,
): Promise<string | null> {
  if (!organizationId) return null
  try {
    const cached = await getCached(
      instructionsCacheKey(organizationId),
      INSTRUCTIONS_CACHE_TTL_MS,
      async () => (await findOrganizationInstructions(organizationId))?.instructions ?? '',
    )
    return cached ? cached : null
  } catch (error) {
    console.warn('[Org instructions] Failed to resolve; sending none:', error)
    return null
  }
}

export async function getOrgInstructions(organizationId: string): Promise<OrgInstructions> {
  const row = await findOrganizationInstructions(organizationId)
  if (!row) return EMPTY
  return {
    instructions: row.instructions,
    updatedBy: row.updatedBy,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function saveOrgInstructions(
  session: AuthorizedSession,
  input: OrgInstructionsInput,
  request: Request,
): Promise<OrgInstructions> {
  const text = input.instructions.trim()

  const result = text
    ? await upsertOrganizationInstructions({
        organizationId: session.organizationId,
        instructions: text,
        updatedBy: session.userId,
        updatedByEmail: session.email,
      })
    : null

  if (!result) {
    await deleteOrganizationInstructions(session.organizationId)
  }

  await invalidateCached(instructionsCacheKey(session.organizationId))

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.settings.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { fields: text ? 'instructions' : 'instructions:cleared' },
    request,
  })

  if (!result) return EMPTY
  return {
    instructions: result.instructions,
    updatedBy: result.updatedBy,
    updatedByEmail: result.updatedByEmail,
    updatedAt: result.updatedAt.toISOString(),
  }
}
