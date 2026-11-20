import 'server-only'
import { inArray, sql } from 'drizzle-orm'
import { inboxItems, type InboxItemType } from '@/lib/db/schema/inbox'
import { MARKS_SET_GROUP_ANCHOR } from './registry'
import { storedInboxTypesOf } from './types'

export const EVERY_INBOX_TYPE = 'every-type' as const

export type InboxTypeScope = readonly InboxItemType[] | typeof EVERY_INBOX_TYPE

export function typeFilter(types: InboxTypeScope | undefined) {
  if (!types || types === EVERY_INBOX_TYPE) return undefined
  if (types.length === 0) return sql`false`
  return inArray(inboxItems.type, storedInboxTypesOf(types))
}

export const foldedOnItsAnchor = () => sql`${inboxItems.groupKey} NOT LIKE ${groupAnchorPattern(MARKS_SET_GROUP_ANCHOR)}`

export const groupAnchorPattern = (prefix: string): string => `%:${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
