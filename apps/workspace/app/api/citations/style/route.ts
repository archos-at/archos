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
