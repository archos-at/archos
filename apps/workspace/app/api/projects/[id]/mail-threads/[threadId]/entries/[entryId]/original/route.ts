import { apiRoute } from '@/lib/api/handler'
import { MAIL_ORIGINAL_DOWNLOAD_LIMIT } from '@/lib/limits/catalog'
import { readEntryOriginal } from '@/lib/mail-thread/originals'

type Params = { id: string; threadId: string; entryId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) =>
    readEntryOriginal(session, params.id, params.threadId, params.entryId),
  {
    authz: {
      enforcedBy:
        'readEntryOriginal -> readableEntry (inbound-mail entitlement; project:view; the thread document screened and in a folder the caller sees)',
    },
    limits: { rule: MAIL_ORIGINAL_DOWNLOAD_LIMIT },
  }
)
