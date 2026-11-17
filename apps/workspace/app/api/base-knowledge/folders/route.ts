/**
 * The folders of the office's base knowledge: the standards root on the office
 * shelf („Grundlagen des Büros“) and its subfolders.
 *
 * GET  — any member, as the office shelf's folders are read.
 * POST — a folder under the root or one of its subfolders; the root is created
 *        on first use. Needs org:office_shelf:manage. A rename, move or delete
 *        is the office shelf folder's own route.
 *
 * Thin handlers; the logic is `@/lib/base-knowledge/office/folders`.
 */

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { createBaseKnowledgeFolder, listBaseKnowledgeFolders } from '@/lib/base-knowledge/office/folders'
import { createFolderBodySchema, listFoldersQuerySchema } from '@/lib/base-knowledge/wire'

export const GET = apiRoute(
  async ({ session, request }) => asProblem(async () => {
    requireOfficeStandardsEnabled(session)
    return listBaseKnowledgeFolders(session, parseQuery(request, listFoldersQuerySchema))
  }),
  {
    authz: {
      sessionOnly: true,
      why: 'any member reads the office shelf folders; listOfficeShelfFolders scopes to session.organizationId',
    },
  },
)

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return createBaseKnowledgeFolder(session, await parseJsonBody(request, createFolderBodySchema))
    }),
  { authz: { enforcedBy: 'createBaseKnowledgeFolder (canManageOfficeShelf)' }, status: 201 },
)
