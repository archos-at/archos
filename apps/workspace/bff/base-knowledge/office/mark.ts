/**
 * Mark a base-knowledge copy's search-index points with its licence mark and
 * edition (ADR-0163): the licensed seam (ADR-0159) keys on `licence_class`,
 * `ai_processing_attested` and `quote_max_chars` to keep licensed text inside
 * its bounds, and a hit names the edition it came from.
 *
 * Best effort, like the folder-path mirror (`documents/move-to-folder.ts`): the
 * records are the durable truth, and a re-ingest carries the same values in its
 * job (`ingest-dispatch.ts`), so a backend that is down costs the mark until then.
 */

import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { licenceMarkFields, type LicenceMark } from './text-use'
import type { EntryDocument } from './repository'

const MARK_TIMEOUT_MS = 5_000

export async function markCopyPoints(document: EntryDocument, editionId: string, mark: LicenceMark): Promise<boolean> {
  const row = { collectionName: document.collectionName, filename: document.storedName }
  try {
    const backendUrl = getBackendUrl()
    const response = await fetch(
      `${backendUrl}/v1/collections/${encodeURIComponent(row.collectionName)}/knowledge-mark`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...internalServiceHeaders(backendUrl) },
        body: JSON.stringify({ file_name: row.filename, ...licenceMarkFields(mark), edition_id: editionId }),
        signal: AbortSignal.timeout(MARK_TIMEOUT_MS),
      }
    )
    if (!response.ok) console.warn(`[base-knowledge] mark refused for ${row.collectionName}: HTTP ${response.status}`)
    return response.ok
  } catch (error) {
    console.warn(`[base-knowledge] mark failed for ${row.collectionName}`, error)
    return false
  }
}
