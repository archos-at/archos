/**
 * The title a released platform text is cited by, from its records (ADR-0165). A text's file is named
 * `<manifestationKey>-<12 hex of its sha256>.pdf`, which no title guess from a file name reads, so the indexing job
 * stamps this one on the corpus document when the text is published (`indexing.ts`).
 */

import { nameOf } from '../chain/text'

/** "<designation>, <edition label>": the work's designation, or its title, and the edition's label. Null when the records name no work. */
export function releasedTextTitle(designation: string | null, workTitle: string | null, editionLabel: string | null): string | null {
  const work = nameOf(designation) || nameOf(workTitle)
  const label = nameOf(editionLabel)
  if (!work) return null
  return label ? `${work}, ${label}` : work
}
