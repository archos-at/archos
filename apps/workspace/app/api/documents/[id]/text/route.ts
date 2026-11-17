/**
 * Text document content — returns a bounded UTF-8 string for the formats the
 * pane renders itself (plain text, Markdown, CSV). 415 for anything else.
 * Thin handler; all logic lives in `@/lib/documents/document-delivery`.
 */

import { apiRoute } from '@/lib/api/handler'
import { doorTextOf } from '@/lib/base-knowledge/door-guard'
import { getDocumentTextPreview } from '@/lib/documents/document-delivery'

type Params = { id: string }

export const GET = apiRoute<Params>(
  // An agent at the door gets a licensed copy's text only within the licence's cumulative quote budget.
  async ({ session, params }) => doorTextOf(session, params.id, () => getDocumentTextPreview(session, params.id)),
  { authz: { enforcedBy: 'getDocumentTextPreview -> getAccessibleDocument (project:view)' } }
)
