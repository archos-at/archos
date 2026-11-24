import 'server-only'
import { and, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations, type Conversation } from '@/lib/db/schema/conversations'
import { resourceShares } from '@/lib/db/schema/resource-shares'

export const CONVERSATION_LIST_LIMIT = 200

function grantNamesCaller(organizationId: string, userId: string) {
  const db = getDb()
  return exists(
    db
      .select({ one: sql`1` })
      .from(resourceShares)
      .where(
        and(
          eq(resourceShares.organizationId, organizationId),
          eq(resourceShares.resourceType, 'conversation'),
          eq(resourceShares.resourceId, conversations.id),
          eq(resourceShares.subjectUserId, userId),
        ),
      ),
  )
}

export function visibleConversationsWhere(
  organizationId: string,
  userId: string,
  projects: { projectIds: readonly string[]; withoutContainer: boolean } | null,
): SQL {
  const orgScope = and(eq(conversations.organizationId, organizationId), isNull(conversations.deletedAt))
  const placed = sql`${conversations.startedInPersonal}`
  const mine = eq(conversations.createdBy, userId)
  const granted = grantNamesCaller(organizationId, userId)

  const withoutContainer = or(mine, granted, eq(conversations.visibility, 'organization'))
  if (!projects) return and(orgScope, or(isNotNull(conversations.projectId), placed), withoutContainer) as SQL

  const { projectIds } = projects
  const inProjects =
    projectIds.length === 0
      ? undefined
      : and(
          projectIds.length === 1
            ? eq(conversations.projectId, projectIds[0])
            : inArray(conversations.projectId, [...projectIds]),
          or(ne(conversations.visibility, 'private'), mine, granted),
        )
  const unstamped = projects.withoutContainer ? and(isNull(conversations.projectId), placed, withoutContainer) : undefined
  return and(orgScope, or(inProjects, unstamped) ?? sql`false`) as SQL
}

export type ConversationPlace = 'personal' | 'project'

function listScope(projectId: string | undefined, place: ConversationPlace | undefined) {
  if (place === 'personal') return { projectIds: [], withoutContainer: true }
  if (place === 'project' && projectId) return { projectIds: [projectId], withoutContainer: false }
  return projectId ? { projectIds: [projectId], withoutContainer: true } : null
}

export async function listVisibleConversations(
  organizationId: string,
  userId: string,
  options: { projectId?: string; place?: ConversationPlace; limit?: number; after?: string } = {},
): Promise<Conversation[]> {
  const { projectId, place, limit = CONVERSATION_LIST_LIMIT, after } = options
  const db = getDb()
  const scope = visibleConversationsWhere(organizationId, userId, listScope(projectId, place))

  const afterCursor = after
    ? sql`(${conversations.updatedAt}, ${conversations.id}) < (select c.updated_at, c.id from conversations c where c.id = ${after} and c.organization_id = ${organizationId})`
    : undefined
  return db
    .select()
    .from(conversations)
    .where(and(scope, afterCursor))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit)
}
