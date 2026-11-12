/**
 * The topic a restated project note takes (ADR-0180). A write that says what an
 * existing note already says refreshes that note; when the write names a topic
 * and the note has none, the note is filed under it. A topic the note already
 * holds is never replaced: the COALESCE keeps it, in the same UPDATE, so two
 * restatements at once cannot overwrite each other.
 *
 * The topic arrives already resolved against the shelf's open topics (the write
 * resolved it, `resolveProjectTopicForWrite`), so this module only decides
 * whether the refresh sets it. `refreshDuplicate` spreads the result into its
 * `.set()`.
 */

import { sql, type SQL } from 'drizzle-orm'
import { projectMemory } from '@/lib/db/schema/project-memory'

/** The `.set()` part that files a refreshed note under `topic`; empty when the write names none. */
export function restatedTopicSet(topic: string | null | undefined): { topic?: SQL<string> } {
  return topic ? { topic: sql<string>`coalesce(${projectMemory.topic}, ${topic})` } : {}
}
