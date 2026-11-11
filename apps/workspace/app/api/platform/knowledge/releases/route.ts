/**
 * Import another deployment's release bundle as a new draft change request. Multipart: `file` (the bundle the
 * export answered, gzipped or not) and an optional `title`. Writes a draft only; review and publish stay here.
 */

import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { parseFormData } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { bundleOf, importCountryRelease } from '@/lib/base-knowledge/platform/release-transfer'
import { releaseImportFieldsSchema } from '@/lib/base-knowledge/platform/release-wire'

export const POST = platformApiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      const form = await parseFormData(request)
      const file = form.get('file')
      if (!(file instanceof File)) throw new BadRequestError('file is required: the bundle platform-knowledge-release-export answered.')
      const fields = releaseImportFieldsSchema.safeParse({ title: form.get('title') ?? undefined })
      if (!fields.success) throw new UnprocessableError('title is at most 200 characters.')
      const bundle = bundleOf(Buffer.from(await file.arrayBuffer()))
      return importCountryRelease(session, { bundle, title: fields.data.title }, actingReaderIsAgent() ? 'agent' : 'person')
    }),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
