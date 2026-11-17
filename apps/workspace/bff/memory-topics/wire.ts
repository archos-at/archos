/**
 * The wire half of a memory topic (ADR-0180): the bounds and the zod fields the
 * route schemas and the agent-door catalog read. A leaf that imports zod alone,
 * so the many schemas that carry a topic field do not pull in the topic logic
 * or the server's error classes (`./topic.ts` holds those and re-exports this).
 */

import { z } from 'zod'

/** The longest topic, in characters (code points): the CHECK of migration 0238 holds the same number. */
export const MEMORY_TOPIC_MAX_LENGTH = 40

/** The longest raw text the wire takes; `normalizeTopic` refuses what is still longer than the topic bound once spaces are collapsed. */
export const MEMORY_TOPIC_WIRE_MAX_CHARS = 200

/** The topic field of a note on the wire: text up to the wire bound, or null to take the note out of its topic. */
export const memoryTopicField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .nullable()
  .describe(`1–3 words in the person's language; reuse a topic. null: none.`)

/** `PATCH …/memory/topics`: every note with topic `from` gets topic `to`; a `to` another topic has merges them. */
export const memoryTopicRenameSchema = z.object({
  from: z
    .string()
    .min(1)
    .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
    .nullable()
    .describe('Topic to rename. null: no topic.'),
  to: memoryTopicField.describe('New name; an existing one merges. null: none.'),
})

/**
 * The `topic` a list filters on, as the query names it: one topic's name, or
 * the empty string for the notes with no topic. The list resolves it against
 * the shelf's own topics (`resolveTopic`), so "brandschutz" finds "Brandschutz".
 */
export const memoryTopicQueryField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .optional()
  .describe('This topic only; empty: none.')
