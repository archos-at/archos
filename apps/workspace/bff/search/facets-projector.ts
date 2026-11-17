import 'server-only'
import type { DocumentMetadata } from '@/lib/documents/reconcile-status'
import { heldAmong } from '@/lib/base-knowledge/text-guard'
import { toSearchFacets } from './facets'
import { upsertSearchFacets } from './facets-repository'

export interface DocumentReading {
  documentId: string
  metadata: DocumentMetadata | null
  superseded: boolean
}

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
