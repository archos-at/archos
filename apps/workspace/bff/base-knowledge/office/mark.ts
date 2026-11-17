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
