/**
 * The citation style of the office's country (`citation_style`), so the browser
 * writes a source's line in that country's form. `{ style: null }` while none is
 * released: the reader then uses its fallback style.
 */

import { apiRoute } from '@/lib/api/handler'
import { citationStylesFor } from '@/lib/citations/style'

export const GET = apiRoute(
  async ({ session }) => ({ style: await citationStylesFor(session.organizationId) }),
  {
    authz: {
      sessionOnly: true,
      why: 'the released citation style of the office’s own country; platform records every office reads',
    },
  }
)
