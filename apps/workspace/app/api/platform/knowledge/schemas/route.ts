/**
 * The JSON Schema of every record type a change request takes (ADR-0170): what
 * `records-propose` parses, generated from the same zod, with the citation's
 * shape, the batch limit and the kit's checks. Platform staff with
 * `platform:settings:view`; an unknown type is refused, never guessed.
 */

import { parseQuery } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { platformKnowledgeSchemas } from '@/lib/base-knowledge/platform/onboarding'
import { schemaQuerySchema } from '@/lib/base-knowledge/platform/wire'

export const GET = platformApiRoute(
  async ({ session, request }) => asProblem(async () => platformKnowledgeSchemas(session, parseQuery(request, schemaQuerySchema).type)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
