/**
 * What the ingest and search paths ask of base knowledge (ADR-0158): whether a
 * document's text is held (never embedded, summarised or faceted), and the mark
 * a confirmed copy's points carry. The one seam from `documents/` and `search/`
 * into these records.
 */

import 'server-only'
import { licenceMarkOf, textUseOf, type LicenceMark } from './office/text-use'
import { copyForDocument, documentsWithEntries, type DocumentCopy } from './store/repository'

export { licenceMarkFields } from './office/text-use'

/**
 * Whether a copy's text stays unread: every copy until a person confirms it,
 * and a confirmed licensed copy whose office has not stated that its licence
 * covers AI processing. What the person confirms (public, or attested) is what
 * releases the text, so nothing reads a licensed copy before anyone knew it was one.
 */
export function textHeldFor(copy: DocumentCopy | null): boolean {
  return copy !== null && (!copy.confirmed || textUseOf(copy.licenceClass, copy.terms) === 'metadata_only')
}

/**
 * Whether the document's text is held. A failed read answers true: when the
 * records cannot be read, an office shelf document's text stays out rather than
 * in (the caller asks only for office shelf rows), and the next re-read retries.
 */
export async function isTextHeld(organizationId: string, documentId: string): Promise<boolean> {
  try {
    return textHeldFor(await copyForDocument(organizationId, documentId))
  } catch {
    return true
  }
}

/**
 * Which of `documentIds` hold their text: what the search projection leaves out,
 * so no summary or facet of a held copy is written. A failed read holds them all;
 * the next refresh writes the rest.
 */
export async function heldAmong(organizationId: string, documentIds: readonly string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  try {
    const copies = await documentsWithEntries(organizationId, documentIds)
    const held = await Promise.all(copies.map(async (id) => ((await isTextHeld(organizationId, id)) ? [id] : [])))
    return new Set(held.flat())
  } catch {
    return new Set(documentIds)
  }
}

/** The mark a confirmed copy's points carry, with its edition; null for any other document. */
export async function copyMarkForIngest(
  organizationId: string,
  documentId: string
): Promise<(LicenceMark & { editionId: string }) | null> {
  const copy = await copyForDocument(organizationId, documentId)
  return copy?.confirmed ? { ...licenceMarkOf(copy.licenceClass, copy.terms), editionId: copy.editionId } : null
}

/**
 * The licence lookup by document id, for the licensed seam (ADR-0159): whether
 * the document is an office copy marked licensed, and whether the office stated
 * its licence covers AI processing. Null for a document that is no base-knowledge
 * copy. A proposed copy counts: its text is withheld until confirmation.
 */
export async function licenceOfDocument(
  organizationId: string,
  documentId: string
): Promise<(LicenceMark & { licensed: boolean; confirmed: boolean }) | null> {
  const copy = await copyForDocument(organizationId, documentId)
  if (!copy) return null
  return { ...licenceMarkOf(copy.licenceClass, copy.terms), licensed: copy.licenceClass === 'licensed', confirmed: copy.confirmed }
}
