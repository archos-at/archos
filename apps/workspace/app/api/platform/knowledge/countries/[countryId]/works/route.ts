/**
 * A country's released works with their editions' labels: what "Add a
 * document" offers to file a PDF under, and how it tells an edition that
 * already exists. Platform staff with `platform:settings:view`.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { parseQuery } from '@/lib/api/handler'
import { listCountryWorks } from '@/lib/base-knowledge/platform/document-add'
import { listWorksQuerySchema } from '@/lib/base-knowledge/platform/document-add-wire'
import { countryIdSchema } from '@/lib/base-knowledge/platform/wire'

type Params = { countryId: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params, request }) => listCountryWorks(session, countryIdSchema.parse(params.countryId), parseQuery(request, listWorksQuerySchema)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
