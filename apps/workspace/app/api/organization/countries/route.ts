/**
 * The office's countries (ADR-0165): its home country and the countries the
 * platform entitled it to, whose platform knowledge its answers draw on.
 */

import { apiRoute } from '@/lib/api/handler'
import { organizationCountries } from '@/lib/base-knowledge/platform/service'

export const GET = apiRoute(async ({ session }) => organizationCountries(session), {
  authz: { sessionOnly: true, why: 'any member may know which countries the office works in; it reads only its own organization' },
})
