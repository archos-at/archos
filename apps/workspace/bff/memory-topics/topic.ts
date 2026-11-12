/**
 * The topic of a memory note (ADR-0180), one module for both shelves: the
 * personal shelf (`bff/personal-memory`) and the project shelf
 * (`bff/projects/memory-topics.ts`). A topic is a text on the note, nothing of
 * its own: this file is the only place that trims, folds case and counts.
 *
 * Pure, and no database: the routes, the services and the agent's writes all
 * pass a raw value through `normalizeTopic` or `resolveTopic`, so "brandschutz"
 * lands in the shelf's "Brandschutz" and never in a second topic of its own.
 */

import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { pageOfList, type OffsetPage, type PageOf } from '@/lib/api/offset-page'

/** The longest topic, in characters (code points): the CHECK of migration 0237 holds the same number. */
export const MEMORY_TOPIC_MAX_LENGTH = 40

/** The longest raw text the wire takes; `normalizeTopic` refuses what is still longer than the topic bound once spaces are collapsed. */
export const MEMORY_TOPIC_WIRE_MAX_CHARS = 200

/**
 * The normal form of a topic, or null for no topic. Unicode-normalized (NFC, so a
 * composed umlaut and its two-part spelling are one topic), trimmed, every run of
 * whitespace one space. Empty is no topic. Longer than `MEMORY_TOPIC_MAX_LENGTH`
 * is a 400: a topic names a subject in a word or three, and a sentence in the
 * topic field is the agent filing a note under its content.
 */
export function normalizeTopic(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw new BadRequestError('A topic is text.')
  const text = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (text === '') return null
  if ([...text].length > MEMORY_TOPIC_MAX_LENGTH) {
    throw new BadRequestError(`A topic is at most ${MEMORY_TOPIC_MAX_LENGTH} characters.`)
  }
  return text
}

/**
 * The topic a write stores, given the topics the shelf already has: the existing
 * spelling when one matches the normalized text (exact first, then any case,
 * compared with the German rules, so „Stellplätze“ and „stellplätze“ are one
 * topic), else the normalized text itself, which then becomes a new topic.
 */
export function resolveTopic(raw: unknown, existing: readonly string[]): string | null {
  const text = normalizeTopic(raw)
  if (text === null) return null
  if (existing.includes(text)) return text
  const folded = text.toLocaleLowerCase('de')
  return existing.find((name) => name.toLocaleLowerCase('de') === folded) ?? text
}

/** One topic of a shelf and how many of the notes a reader sees it on. */
export interface MemoryTopicCount {
  name: string
  count: number
}

/**
 * The topics of a shelf, from the topic of each note a reader can see (null is
 * no topic and is not counted): most notes first, then by name, so the order
 * is the same on every screen. Computed here, from the rows the caller already
 * holds, never by a count over a whole table: a count would include notes the
 * reader may not see.
 */
export function summarizeTopics(items: readonly { topic: string | null }[]): MemoryTopicCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.topic === null) continue
    counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
}

/** The topic field of a note on the wire: text up to the wire bound, or null to take the note out of its topic. */
export const memoryTopicField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .nullable()
  .describe(
    `The note's topic: one to three words naming its subject ("Brandschutz", not "Entscheidung"), reusing a topic the shelf already has. Max ${MEMORY_TOPIC_MAX_LENGTH} characters. null: no topic.`
  )

/** `PATCH …/memory/topics`: every note with topic `from` gets topic `to`; a `to` another topic has merges them. */
export const memoryTopicRenameSchema = z.object({
  from: z
    .string()
    .min(1)
    .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
    .nullable()
    .describe('The topic to rename, as the topics list names it. null: the notes with no topic.'),
  to: memoryTopicField.describe(
    'The new name. A name another topic already has (any case) merges the notes into it. null: the notes lose their topic.'
  ),
})

export type MemoryTopicRenameInput = z.infer<typeof memoryTopicRenameSchema>

/**
 * A rename's `from`, checked before anything is read or written: null is the notes
 * with no topic, and text that is blank once trimmed is refused (400). Read as no
 * topic, a blank `from` would silently move the notes that have none.
 */
export function requireRenameFrom(from: string | null): void {
  if (from !== null && normalizeTopic(from) === null) {
    throw new BadRequestError('The topic to rename is named by its text, or null for the notes with no topic.')
  }
}

/**
 * The `topic` a list filters on, as the query names it: one topic's name, or
 * the empty string for the notes with no topic. The list resolves it against
 * the shelf's own topics (`resolveTopic`), so "brandschutz" finds "Brandschutz".
 */
export const memoryTopicQueryField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .optional()
  .describe('Only the notes on this topic, as topics names it. Empty: the notes with no topic.')

/**
 * One page of a list's visible items, filtered to a topic: the items of that
 * topic in the order given, then the page. The filter runs after visibility, on
 * the items the reader may see; a topic only restricted notes hold selects nothing.
 * `topic` is the query's value; null (no topic) selects the notes with no topic.
 */
export function pageOfTopic<T extends { topic: string | null }>(
  items: readonly T[],
  topic: string,
  page: OffsetPage
): PageOf<T> {
  const names = [...new Set(items.flatMap((item) => (item.topic === null ? [] : [item.topic])))]
  const wanted = resolveTopic(topic, names)
  const onTopic = items.filter((item) => item.topic === wanted)
  const { rows, nextCursor } = pageOfList(onTopic, page)
  return { items: rows, nextCursor }
}
