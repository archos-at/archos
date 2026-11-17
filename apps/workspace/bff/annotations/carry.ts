import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { REVISION_MAX_HISTORY } from '@/lib/documents/revision-links'
import { loadRevisionLinks } from '@/lib/documents/revision-links-loader'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'

export async function replacingDocumentOf(session: AuthorizedSession, doc: Document): Promise<Document | null> {
  const seen = new Set([doc.id])
  let current = doc
  for (let step = 0; step < REVISION_MAX_HISTORY; step += 1) {
    const facts = await loadRevisionLinks(session, [current], await shelfReaderFor(session, current))
    const next = facts.get(current.id)?.supersededBy ?? null
    if (!next || seen.has(next.id)) break
    seen.add(next.id)
    const opened = await getAccessibleDocument(session, next.id, 'read').catch((error: unknown) => {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) return null
      throw error
    })
    if (!opened) break
    current = opened
  }
  return current.id === doc.id ? null : current
}
