import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { readOfficeEntries } from '@/lib/base-knowledge/store/repository'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { officeDocumentHashes } from './repository'
import { workKey, type HeldEdition, type HeldWorks } from './placement'

export async function heldWorks(session: AuthorizedSession): Promise<HeldWorks> {
  const entries = await readOfficeEntries(session.organizationId)
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  const hashes = await officeDocumentHashes(
    session.organizationId,
    entries.map((entry) => entry.documentId),
    reader
  )
  const works = new Map<string, HeldEdition[]>()
  for (const entry of entries) {
    const key = workKey(entry.values.designation)
    if (!key || !hashes.has(entry.documentId)) continue
    works.set(key, [...(works.get(key) ?? []), { entry, contentHash: hashes.get(entry.documentId) ?? null }])
  }
  return works
}
