import { sql } from 'drizzle-orm'

export const OUTSIDE_LICENSED_TEXT = sql`coalesce(m.metadata->>'licensedText', '') <> 'true'`
