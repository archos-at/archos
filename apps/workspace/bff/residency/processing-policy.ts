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
