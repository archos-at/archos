import { apiRoute, parseQuery } from '@/lib/api/handler'
import { mailThreadListQuerySchema } from '@/lib/mail-thread/mail-thread-wire'
import { listMailThreads } from '@/lib/mail-thread/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => listMailThreads(session, params.id, parseQuery(request, mailThreadListQuerySchema)),
  { authz: { enforcedBy: 'listMailThreads (inbound-mail entitlement; project:view; each thread document screened and in a folder the caller sees)' } },
)
