import { apiRoute, parseQuery } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { editionAsOfForSession } from '@/lib/base-knowledge/time/service'
import { asOfQuerySchema } from '@/lib/base-knowledge/wire/time'

export const GET = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => editionAsOfForSession(session, parseQuery(request, asOfQuerySchema))),
  {
    authz: {
      sessionOnly: true,
      why: 'any member reads base knowledge; the reads are keyed by session.organizationId under withTenant, and a project procedure is read through getProjectProfile, which requires project:view',
    },
  }
)
