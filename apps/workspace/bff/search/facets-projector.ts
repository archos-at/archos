/**
 * Write the search rows of documents whose reading is known (ADR-0136): the
 * one door into `document_search_facets`. Called where a document settles
 * (`reconcileDocumentStatuses`) and by the shelf's backstop refresh
 * (`./shelf-projection.ts`). A reading the listing did not carry writes
 * nothing, so a degraded listing never blanks a row.
 */

import 'server-only'
import type { DocumentMetadata } from '@/lib/documents/reconcile-status'
import { heldAmong } from '@/lib/base-knowledge/text-guard'
import { toSearchFacets } from './facets'
import { upsertSearchFacets } from './facets-repository'

/** One document's reading, as the caller already holds it. */
export interface DocumentReading {
  documentId: string
  metadata: DocumentMetadata | null
  superseded: boolean
}

/**
 * Project `readings` into their search rows; how many rows changed. A base-knowledge
 * copy whose text is held (ADR-0158) gets no row: its summary and facets are a
 * reading of text nobody may read yet.
 */
export async function projectReadings(organizationId: string, readings: readonly DocumentReading[]): Promise<number> {
  const held = await heldAmong(organizationId, readings.map((reading) => reading.documentId))
  const rows = readings.flatMap((reading) => {
    if (held.has(reading.documentId)) return []
    const row = toSearchFacets(
      { documentId: reading.documentId, organizationId, superseded: reading.superseded },
      reading.metadata
    )
    return row ? [row] : []
  })
  return upsertSearchFacets(organizationId, rows)
}
