/**
 * Which edition of a work applied (ADR-0171, ticket 30): on a date (`asOf`),
 * or to a permit procedure, given here or stored on a project's profile, by the
 * legislating node's reference-date rule and the amending editions'
 * transitions. Answers with the edition named, or `undetermined` naming what
 * is missing.
 *
 * GET — any member may read, as base knowledge is read; a project's procedure
 *       needs project:view on it (checked in the service).
 *
 * Thin handler; the logic is `@/lib/base-knowledge/time/service`.
 */

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
