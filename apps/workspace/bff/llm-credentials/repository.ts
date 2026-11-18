import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { orgLlmCredentials, type NewOrgLlmCredential, type OrgLlmCredential } from '@/lib/db/schema/org-llm-credentials'

export async function listCredentials(organizationId: string, limit = 50): Promise<OrgLlmCredential[]> {
  const db = getDb()
  return db
    .select()
    .from(orgLlmCredentials)
    .where(eq(orgLlmCredentials.organizationId, organizationId))
    .orderBy(desc(orgLlmCredentials.createdAt))
    .limit(limit)
}

export async function getCredential(organizationId: string, id: string): Promise<OrgLlmCredential | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(orgLlmCredentials)
    .where(and(eq(orgLlmCredentials.id, id), eq(orgLlmCredentials.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export async function getActiveCredential(organizationId: string): Promise<OrgLlmCredential | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(orgLlmCredentials)
    .where(and(eq(orgLlmCredentials.organizationId, organizationId), eq(orgLlmCredentials.status, 'active')))
    .limit(1)
  return row ?? null
}

export async function insertActiveCredential(
  values: NewOrgLlmCredential,
  actorUserId: string,
): Promise<{ inserted: OrgLlmCredential; superseded: OrgLlmCredential | null }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(orgLlmCredentials)
      .where(
        and(
          eq(orgLlmCredentials.organizationId, values.organizationId),
          eq(orgLlmCredentials.status, 'active'),
        ),
      )
      .limit(1)

    if (current) {
      await tx
        .update(orgLlmCredentials)
        .set({ status: 'revoked', revokedAt: new Date(), revokedBy: actorUserId })
        .where(eq(orgLlmCredentials.id, current.id))
    }

    const [inserted] = await tx
      .insert(orgLlmCredentials)
      .values({ ...values, status: 'active' })
      .returning()

    return { inserted, superseded: current ?? null }
  })
}

export async function revokeCredential(
  organizationId: string,
  id: string,
  actorUserId: string,
): Promise<OrgLlmCredential | null> {
  const db = getDb()
  const [row] = await db
    .update(orgLlmCredentials)
    .set({ status: 'revoked', revokedAt: new Date(), revokedBy: actorUserId, encryptedKey: null })
    .where(
      and(
        eq(orgLlmCredentials.id, id),
        eq(orgLlmCredentials.organizationId, organizationId),
        eq(orgLlmCredentials.status, 'active'),
      ),
    )
    .returning()
  return row ?? null
}

export async function markVerified(organizationId: string, id: string): Promise<void> {
  const db = getDb()
  await db
    .update(orgLlmCredentials)
    .set({ lastVerifiedAt: new Date() })
    .where(and(eq(orgLlmCredentials.id, id), eq(orgLlmCredentials.organizationId, organizationId)))
}

export async function markUsed(organizationId: string, id: string): Promise<void> {
  const db = getDb()
  await db
    .update(orgLlmCredentials)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(orgLlmCredentials.id, id), eq(orgLlmCredentials.organizationId, organizationId)))
}
