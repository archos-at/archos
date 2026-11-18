import 'server-only'
import { and, asc, eq, inArray, notExists, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { mentionRequests, type MentionRequest, type MentionRequestStatus, type MentionResolution, type NewMentionRequest } from '@/lib/db/schema/mention-requests'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'

export const OPEN_REQUEST_LIMIT = 50

export async function insertMentionRequests(values: NewMentionRequest[]): Promise<MentionRequest[]> {
  if (values.length === 0) return []
  const db = getDb()
  return db.insert(mentionRequests).values(values).returning()
}

export async function listOpenRequestsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
  limit = OPEN_REQUEST_LIMIT,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .select()
    .from(mentionRequests)
    .where(
      and(
        eq(mentionRequests.resourceType, resourceType),
        eq(mentionRequests.resourceId, resourceId),
        eq(mentionRequests.status, 'open'),
      ),
    )
    .orderBy(asc(mentionRequests.createdAt))
    .limit(limit)
}

export async function listOpenRequestsForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  requestedOf: string,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .select()
    .from(mentionRequests)
    .where(
      and(
        eq(mentionRequests.resourceType, resourceType),
        eq(mentionRequests.resourceId, resourceId),
        eq(mentionRequests.requestedOf, requestedOf),
        eq(mentionRequests.status, 'open'),
      ),
    )
    .orderBy(asc(mentionRequests.createdAt))
    .limit(OPEN_REQUEST_LIMIT)
}

const STATUS_FOR_RESOLUTION: Record<MentionResolution, MentionRequestStatus> = {
  answered: 'answered',
  asked_back: 'answered',
  released: 'released',
  void: 'void',
}

export async function resolveRequests(
  requestIds: string[],
  resolution: MentionResolution,
  resolvedBy: string | null,
): Promise<MentionRequest[]> {
  if (requestIds.length === 0) return []
  const db = getDb()
  const status = STATUS_FOR_RESOLUTION[resolution]
  return db
    .update(mentionRequests)
    .set({ status, resolution, resolvedBy, resolvedAt: new Date() })
    .where(and(inArray(mentionRequests.id, requestIds), eq(mentionRequests.status, 'open')))
    .returning()
}

export async function voidOpenRequestsForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  requestedOf: string,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .update(mentionRequests)
    .set({ status: 'void', resolution: 'void', resolvedAt: new Date() })
    .where(
      and(
        eq(mentionRequests.resourceType, resourceType),
        eq(mentionRequests.resourceId, resourceId),
        eq(mentionRequests.requestedOf, requestedOf),
        eq(mentionRequests.status, 'open'),
      ),
    )
    .returning()
}

export async function voidOpenRequestsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .update(mentionRequests)
    .set({ status: 'void', resolution: 'void', resolvedAt: new Date() })
    .where(
      and(
        eq(mentionRequests.resourceType, resourceType),
        eq(mentionRequests.resourceId, resourceId),
        eq(mentionRequests.status, 'open'),
      ),
    )
    .returning()
}

export async function listOpenRequestsByAsker(
  organizationId: string,
  requestedBy: string,
  limit = OPEN_REQUEST_LIMIT,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .select()
    .from(mentionRequests)
    .where(
      and(
        eq(mentionRequests.organizationId, organizationId),
        eq(mentionRequests.requestedBy, requestedBy),
        eq(mentionRequests.status, 'open'),
      ),
    )
    .orderBy(asc(mentionRequests.createdAt))
    .limit(limit)
}

export async function findRequestById(requestId: string): Promise<MentionRequest | null> {
  const db = getDb()
  const [row] = await db.select().from(mentionRequests).where(eq(mentionRequests.id, requestId)).limit(1)
  return row ?? null
}

export async function voidOpenRequestsForSubjectInProject(
  organizationId: string,
  projectId: string,
  requestedOf: string,
): Promise<MentionRequest[]> {
  const db = getDb()
  return db
    .update(mentionRequests)
    .set({ status: 'void', resolution: 'void', resolvedAt: new Date() })
    .where(
      and(
        eq(mentionRequests.organizationId, organizationId),
        eq(mentionRequests.requestedOf, requestedOf),
        eq(mentionRequests.resourceType, 'conversation'),
        eq(mentionRequests.status, 'open'),
        inArray(
          mentionRequests.resourceId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(eq(conversations.organizationId, organizationId), eq(conversations.projectId, projectId)),
            ),
        ),
      ),
    )
    .returning()
}

export async function deleteOrphanedMentionRequests(limit = 500): Promise<number> {
  const db = getDb()
  const orphans = await db
    .select({ id: mentionRequests.id })
    .from(mentionRequests)
    .where(
      and(
        or(
          and(
            eq(mentionRequests.resourceType, 'conversation'),
            notExists(
              db
                .select({ one: sql`1` })
                .from(conversations)
                .where(eq(conversations.id, mentionRequests.resourceId)),
            ),
          ),
          and(
            eq(mentionRequests.resourceType, 'document'),
            notExists(
              db
                .select({ one: sql`1` })
                .from(documents)
                .where(sql`${documents.id}::text = ${mentionRequests.resourceId}`),
            ),
          ),
        ),
      ),
    )
    .limit(limit)
  if (orphans.length === 0) return 0
  const rows = await db
    .delete(mentionRequests)
    .where(
      inArray(
        mentionRequests.id,
        orphans.map((row) => row.id),
      ),
    )
    .returning({ id: mentionRequests.id })
  return rows.length
}

export async function deleteRequestsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .delete(mentionRequests)
    .where(and(eq(mentionRequests.resourceType, resourceType), eq(mentionRequests.resourceId, resourceId)))
    .returning({ id: mentionRequests.id })
  return rows.length
}
