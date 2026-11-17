/**
 * Add an uploaded PDF to a country in one call. Multipart: `file`, and the
 * fields of `uploadDocumentFields` (`work` as JSON). Its records quote the
 * title lines the person copied from it, which the reviewer checks against
 * where it is published.
 */

import { parseFormData } from '@/lib/api/handler'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { uploadPlatformDocument } from '@/lib/base-knowledge/platform/document-add'
import { uploadDocumentFieldsSchema } from '@/lib/base-knowledge/platform/document-add-wire'
import { countryIdSchema } from '@/lib/base-knowledge/platform/wire'

type Params = { countryId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const form = await parseFormData(request)
      const file = form.get('file')
      if (!(file instanceof File)) throw new BadRequestError('file is required')
      const fields = uploadDocumentFieldsSchema.safeParse(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file')))
      if (!fields.success) {
        throw new UnprocessableError(`The fields are incomplete: ${fields.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
      }
      return uploadPlatformDocument(session, countryIdSchema.parse(params.countryId), fields.data, file, actingReaderIsAgent() ? 'agent' : 'person')
    }),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
