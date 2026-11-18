// drop after release 2026-W50: a backend one release old answers the document id under its old name.
import type { BackendSearchHit } from './semantic-search'

export const hitDocumentId = (hit: BackendSearchHit): string | undefined => hit.document_id ?? hit.grid_document_id
