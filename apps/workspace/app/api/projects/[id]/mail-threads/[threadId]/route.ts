import { apiRoute } from '@/lib/api/handler'
import { getMailThread } from '@/lib/mail-thread/service'

type Params = { id: string; threadId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getMailThread(session, params.id, params.threadId), {
  authz: { enforcedBy: 'getMailThread (inbound-mail entitlement; project:view; the thread document screened and in a folder the caller sees)' },
})
