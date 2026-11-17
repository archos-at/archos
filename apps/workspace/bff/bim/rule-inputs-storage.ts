import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimModels } from '@/lib/db/schema/bim'
import type { StoredRuleInputs } from './rule-inputs'

export async function loadBimRuleInputs(
  modelId: string,
  organizationId: string
): Promise<unknown | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ ruleInputs: bimModels.ruleInputs })
      .from(bimModels)
      .where(and(eq(bimModels.id, modelId), eq(bimModels.organizationId, organizationId)))
      .limit(1)
  )
  return rows[0]?.ruleInputs ?? null
}

export async function saveBimRuleInputs(
  modelId: string,
  organizationId: string,
  ruleInputs: StoredRuleInputs,
  expected: unknown
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(bimModels)
      .set({ ruleInputs })
      .where(
        and(
          eq(bimModels.id, modelId),
          eq(bimModels.organizationId, organizationId),
          sql`${bimModels.ruleInputs} IS NOT DISTINCT FROM ${
            expected === null || expected === undefined
              ? sql`NULL::jsonb`
              : sql`${JSON.stringify(expected)}::jsonb`
          }`
        )
      )
  )
}
