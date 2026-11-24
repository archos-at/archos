import { apiRoute, parseQuery } from '@/lib/api/handler'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { listFolderBin } from '@/lib/projects/folder-bin'
import { binListQuerySchema } from '@/lib/projects/folder-bin-wire'

export const GET = apiRoute(
  async ({ session, request }) => listFolderBin(session, OFFICE_SHELF, parseQuery(request, binListQuerySchema)),
  { authz: { enforcedBy: 'listFolderBin (any member reads the office shelf; canRestore and canPurge need org:office_shelf:manage)' } }
)
