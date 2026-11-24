import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { shelfChatsHiddenFromAgent } from '@/lib/conversations/shelf-titles'
import type { InboxItem } from '@/lib/db/schema/inbox'
import { nonEmpty } from './inbox-payload-coercion'

const conversationOf = (row: InboxItem): string | null =>
  row.resourceType === 'conversation' ? row.resourceId : (nonEmpty((row.payload ?? {}).conversationId) ?? null)

export async function rowsAboutShelfChatsHiddenFromAgent(
  session: AuthorizedSession,
  rows: readonly InboxItem[],
): Promise<Set<string>> {
  const named = rows.flatMap((row) => conversationOf(row) ?? [])
  const hidden = await shelfChatsHiddenFromAgent(session.organizationId, session.userId, named)
  return new Set(rows.filter((row) => hidden.has(conversationOf(row) ?? '')).map((row) => row.id))
}
