import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'

export const DAY_MS = 24 * 60 * 60 * 1000

export const mailProjectFree = sql`NOT legal_hold_blocks('project', m.project_id::text, m.organization_id)`

const mailSenderFree = sql`(m.sender_user_id IS NULL OR NOT legal_hold_blocks('user', m.sender_user_id, m.organization_id))`

export const mailErasable = sql`${mailProjectFree} AND ${mailSenderFree}`

const rowsOf = <T>(result: Iterable<unknown>): T[] => Array.from(result) as T[]

export async function select<T>(statement: SQL): Promise<T[]> {
  return rowsOf<T>(await getDb().execute(statement))
}
