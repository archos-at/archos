/**
 * An organization's processing policy, as the agent tier reads it (ADR-0167).
 *
 * Its cell (`organizations.residency_cell`) and the purposes its data may be
 * processed for (`organization_processing_policies`, migration 0203). Reported
 * to the Python backend on `/api/internal/model-overrides` beside the ZDR bit,
 * where `agent.common.residency.parse_policy` reads it: the backend refuses an
 * organization placed in another cell and tags each chat trace with
 * `purpose_ok`, which the Langfuse judges require. No row reads as the
 * defaults; a policy the backend cannot read allows `service` alone.
 */

import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { organizations } from '@/lib/db/schema/organizations'
import { organizationProcessingPolicies } from '@/lib/db/schema/organization-processing-policies'

export const PURPOSES = [
  'service',
  'quality_evaluation',
  'human_review',
  'product_improvement',
] as const
export type Purpose = (typeof PURPOSES)[number]

/** What an organization without a row allows. `product_improvement` is opt-in. */
export const DEFAULT_PURPOSES: readonly Purpose[] = [
  'service',
  'quality_evaluation',
  'human_review',
]

export interface ProcessingPolicyWire {
  residencyCell: string | null
  purposes: Purpose[]
  version: number
}

function isPurpose(value: string): value is Purpose {
  return (PURPOSES as readonly string[]).includes(value)
}

/** The organization's policy; two primary-key reads in its tenant context. */
export async function getProcessingPolicy(organizationId: string): Promise<ProcessingPolicyWire> {
  const db = getDb()
  const [placement, policy] = await withTenant({ organizationId }, () =>
    Promise.all([
      db
        .select({ residencyCell: organizations.residencyCell })
        .from(organizations)
        .where(eq(organizations.workosOrganizationId, organizationId))
        .limit(1),
      db
        .select({
          purposes: organizationProcessingPolicies.purposesAllowed,
          version: organizationProcessingPolicies.version,
        })
        .from(organizationProcessingPolicies)
        .where(eq(organizationProcessingPolicies.organizationId, organizationId))
        .limit(1),
    ])
  )
  const row = policy[0]
  return {
    residencyCell: placement[0]?.residencyCell ?? null,
    purposes: row ? row.purposes.filter(isPurpose) : [...DEFAULT_PURPOSES],
    version: row?.version ?? 1,
  }
}
