import 'server-only'
import { and, count, desc, eq, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { savedSearches, type SavedSearchRow } from '@/lib/db/schema/saved-searches'
import { withTenant } from '@/lib/db/tenant-context'
import type { OffsetPage } from '@/lib/api/offset-page'
import type { SearchBody, SearchScopeQuery } from './search-wire'

export interface SavedSearchOwner {
  organizationId: string
  userId: string
}

export async function listVisibleSavedSearches(reader: SavedSearchOwner, page: OffsetPage): Promise<SavedSearchRow[]> {
  return withTenant({ organizationId: reader.organizationId }, () =>
    getDb()
      .select()
      .from(savedSearches)
      .where(
        and(
          eq(savedSearches.organizationId, reader.organizationId),
          or(eq(savedSearches.ownerUserId, reader.userId), eq(savedSearches.shared, true))
        )
      )
      .orderBy(desc(savedSearches.createdAt), desc(savedSearches.id))
      .limit(page.limit + 1)
      .offset(page.offset)
  )
}

export async function countOwnedSavedSearches(owner: SavedSearchOwner): Promise<number> {
  const [row] = await withTenant({ organizationId: owner.organizationId }, () =>
    getDb()
      .select({ n: count() })
      .from(savedSearches)
      .where(and(eq(savedSearches.organizationId, owner.organizationId), eq(savedSearches.ownerUserId, owner.userId)))
  )
  return Number(row?.n ?? 0)
}

export async function insertSavedSearch(
  owner: SavedSearchOwner,
  values: { name: string; scope: SearchScopeQuery; query: SearchBody; shared: boolean }
): Promise<SavedSearchRow> {
  const [row] = await withTenant({ organizationId: owner.organizationId }, () =>
    getDb()
      .insert(savedSearches)
      .values({ organizationId: owner.organizationId, ownerUserId: owner.userId, ...values })
      .returning()
  )
  if (!row) throw new Error('insert into saved_searches returned no row')
  return row
}

export async function updateOwnSavedSearch(
  owner: SavedSearchOwner,
  id: string,
  patch: { name?: string; shared?: boolean }
): Promise<SavedSearchRow | null> {
  const [row] = await withTenant({ organizationId: owner.organizationId }, () =>
    getDb()
      .update(savedSearches)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(savedSearches.organizationId, owner.organizationId),
          eq(savedSearches.ownerUserId, owner.userId),
          eq(savedSearches.id, id)
        )
      )
      .returning()
  )
  return row ?? null
}

export async function deleteOwnSavedSearch(owner: SavedSearchOwner, id: string): Promise<boolean> {
  const rows = await withTenant({ organizationId: owner.organizationId }, () =>
    getDb()
      .delete(savedSearches)
      .where(
        and(
          eq(savedSearches.organizationId, owner.organizationId),
          eq(savedSearches.ownerUserId, owner.userId),
          eq(savedSearches.id, id)
        )
      )
      .returning({ id: savedSearches.id })
  )
  return rows.length > 0
}
