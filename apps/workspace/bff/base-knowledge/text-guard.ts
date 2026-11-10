/**
 * What the ingest path asks of base knowledge (ADR-0158): whether a document
 * is a metadata-only copy, which is never indexed, and the mark a confirmed
 * copy's points carry. The one seam from `documents/` into these records.
 */

import 'server-only'
import { licenceMarkOf, textUseOf, type LicenceMark } from './office/text-use'
import { copyForDocument } from './store/repository'

export { licenceMarkFields } from './office/text-use'

/**
 * A licensed copy (proposed or confirmed) whose office has not stated that its
 * licence covers AI processing. A failed read answers true: when the records
 * cannot be read, an office shelf document's text stays out rather than in
 * (the caller asks only for office shelf rows), and the next re-read retries.
 */
export async function isMetadataOnlyCopy(organizationId: string, documentId: string): Promise<boolean> {
  try {
    const copy = await copyForDocument(organizationId, documentId)
    return copy !== null && textUseOf(copy.licenceClass, copy.terms) === 'metadata_only'
  } catch {
    return true
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
