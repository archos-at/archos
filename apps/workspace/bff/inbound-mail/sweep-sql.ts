/**
 * What the E-Mail-Eingang's sweeps share (ADR-0137, `./sweep-repository.ts`):
 * the legal-hold filters every erasing or deleting set asks, and a raw select.
 */

import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'

export const DAY_MS = 24 * 60 * 60 * 1000

/** No legal hold covers the mail's project: what every erasing or deleting set asks (`m` is `inbound_mails`). */
export const mailProjectFree = sql`NOT legal_hold_blocks('project', m.project_id::text, m.organization_id)`

/** No custodian hold covers the member the mail came from: its bytes are theirs to keep. */
const mailSenderFree = sql`(m.sender_user_id IS NULL OR NOT legal_hold_blocks('user', m.sender_user_id, m.organization_id))`

/** Both: the mail's bytes may be erased now. */
export const mailErasable = sql`${mailProjectFree} AND ${mailSenderFree}`

const rowsOf = <T>(result: Iterable<unknown>): T[] => Array.from(result) as T[]

export async function select<T>(statement: SQL): Promise<T[]> {
  return rowsOf<T>(await getDb().execute(statement))
}
