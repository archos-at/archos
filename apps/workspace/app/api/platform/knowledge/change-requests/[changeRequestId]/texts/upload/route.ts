/**
 * Attach an uploaded PDF to a manifestation of a draft change request
 * (ADR-0165, "Texts are attached in the request"). Multipart: `file`, and
 * `manifestationKey`. The file goes into the base corpus, where nobody reads
 * it until the request is published, and the manifestation names it.
 */

import { parseFormData } from '@/lib/api/handler'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { uploadPlatformText } from '@/lib/base-knowledge/platform/texts'
import { uploadTextFieldsSchema } from '@/lib/base-knowledge/platform/text-wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const form = await parseFormData(request)
      const file = form.get('file')
      if (!(file instanceof File)) throw new BadRequestError('file is required')
      const fields = uploadTextFieldsSchema.safeParse({ manifestationKey: form.get('manifestationKey') })
      if (!fields.success) throw new UnprocessableError('manifestationKey is required: the key of a manifestation proposed in this change request.')
      return uploadPlatformText(session, params.changeRequestId, fields.data.manifestationKey, file, actingReaderIsAgent() ? 'agent' : 'person')
    }),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
