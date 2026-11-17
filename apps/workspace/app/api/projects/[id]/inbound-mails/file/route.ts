import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { fileInboundMailsBodySchema } from '@/lib/inbound-mail/inbound-mail-wire'
import { fileInboundMails } from '@/lib/inbound-mail/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => fileInboundMails(session, params.id, await parseJsonBody(request, fileInboundMailsBodySchema)),
  {
    authz: {
      enforcedBy:
        'fileInboundMails -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit) ' +
        'and requireDecisionRights (requireFolderWrite on every target folder)',
    },
    status: 202,
  },
)
