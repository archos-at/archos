/**
 * INTERNAL service endpoint — tells the ingest pipeline whether the document
 * it was dispatched for still exists. Asked once per file, after the file is
 * indexed and before its previous version is retired: a document deleted
 * while its ingest ran (a delete on another replica during a same-name
 * re-ingest, or one landing after the upload recorded its version and before
 * the dispatch ran) would otherwise stay indexed with no row behind it. On
 * `exists: false` the pipeline takes back out the chunks that attempt
 * inserted (`knowledge_layer/ingest/document_presence.py`).
 *
 * A base-knowledge copy whose text is held (ADR-0158) answers `exists: false`
 * too: a proposal made while its ingest ran purged the passages, and the job
 * that then wrote chunks takes them out here, so the last writer loses. The
 * office is read from the collection name when the job did not send it.
 *
 * Always 200 with `{ exists }`, never a 404 for a missing row: the backend
 * discards on a definite "no" only, and a 404 is also what a BFF that predates
 * this route answers. Anything but a 200 it reads as "present".
 *
 * Service-to-service only: `INTERNAL_API_TOKEN` via `internalApiRoute`,
 * fail-closed when unconfigured. Addressed like the image presign route, by
 * document id AND collection; `organizationId` (the org the ingest was
 * dispatched for) narrows the lookup to that tenant when sent. Read-only, and
 * it answers one bit about a row whose unguessable id the caller already holds.
 */

import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { documentStillExists } from '@/lib/documents/document-details'
import { isTextHeld } from '@/lib/base-knowledge/text-guard'
import { isOfficeShelfCollectionName, officeShelfOrganizationId } from '@/lib/office-shelf/collection-prefix'

const querySchema = z.object({
  documentId: z.guid(),
  collection: z.string().min(1),
  organizationId: z.string().min(1).optional(),
})

export const GET = internalApiRoute(
  'document-exists',
  async ({ request }) => {
    const { documentId, collection, organizationId } = parseQuery(request, querySchema)
    if (!(await documentStillExists(documentId, collection, organizationId))) return { exists: false }
    if (!isOfficeShelfCollectionName(collection)) return { exists: true }
    const office = organizationId ?? officeShelfOrganizationId(collection)
    return { exists: !(office && (await isTextHeld(office, documentId))) }
  },
  { tenancy: { fromPayload: '?organizationId, the org the ingest was dispatched for' } }
)
