/**
 * What the ingest path asks of base knowledge (ADR-0158): whether a document
 * is a metadata-only copy, which is never indexed, and the mark a confirmed
 * copy's points carry. The one seam from `documents/` into these records.
 */

import 'server-only'
import { textUseOf } from './office/text-use'
import { copyForDocument } from './store/repository'

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

/** The licence class and edition a confirmed copy's points carry; null for any other document. */
export async function copyMarkForIngest(
  organizationId: string,
  documentId: string
): Promise<{ licenceClass: string; editionId: string } | null> {
  const copy = await copyForDocument(organizationId, documentId)
  return copy?.confirmed ? { licenceClass: copy.licenceClass, editionId: copy.editionId } : null
}
