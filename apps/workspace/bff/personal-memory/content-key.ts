/**
 * The key two personal notes are the same note by (ADR-0180): the stored
 * column `personal_memory.content_key` (migration 0231) and its unique index.
 *
 * Computed here and nowhere else. The project store keeps its normaliser twice,
 * as `normalizeContent` in TypeScript and as an index expression in SQL
 * (migration 0010), and both fold with `[^a-z0-9]+`: text with no ASCII letter
 * folds to nothing and an umlaut to a space. For personal notes that made
 * „Привет“ and „ÄÖÜ“ the same note, so the second answered 201 with the first
 * one's id and overwrote nothing while claiming success. A stored column ends
 * the second copy: the database only compares what this function wrote.
 *
 * Pure.
 */

import { BadRequestError } from '@/lib/api/errors'

/** Any run of what is neither a letter nor a digit, in any script. */
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu

/** NFKC (so `ﬁ` is `fi` and a full-width digit a digit), lower case, every other run a single space, trimmed. */
export function personalContentKey(content: string): string {
  return content.normalize('NFKC').toLowerCase().replace(NOT_LETTER_OR_DIGIT, ' ').trim()
}

/** The key of a note that may be stored: a note with no letter and no digit says nothing to keep (400). */
export function requirePersonalContentKey(content: string): string {
  const key = personalContentKey(content)
  if (!key) throw new BadRequestError('A personal note needs at least one letter or digit.')
  return key
}
