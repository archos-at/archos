import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { organizationInstructions, type OrganizationInstructions } from '@/lib/db/schema/organization-instructions'

export async function findOrganizationInstructions(
  organizationId: string,
): Promise<OrganizationInstructions | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(organizationInstructions)
      .where(eq(organizationInstructions.organizationId, organizationId))
      .limit(1),
  )
  return row ?? null
}

export async function upsertOrganizationInstructions(values: {
  organizationId: string
  instructions: string
  updatedBy: string
  updatedByEmail: string | null
}): Promise<OrganizationInstructions> {
  const db = getDb()
  const row = {
    instructions: values.instructions,
    updatedBy: values.updatedBy,
    updatedByEmail: values.updatedByEmail,
    updatedAt: new Date(),
  }
  const [saved] = await withTenant({ organizationId: values.organizationId }, () =>
    db
      .insert(organizationInstructions)
      .values({ organizationId: values.organizationId, ...row })
      .onConflictDoUpdate({ target: organizationInstructions.organizationId, set: row })
      .returning(),
  )
  return saved
}

export async function deleteOrganizationInstructions(organizationId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(organizationInstructions)
      .where(eq(organizationInstructions.organizationId, organizationId)),
  )
}
