import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { presignBaseCorpusUpload } from '@/lib/knowledge/base-corpus-storage'

const bodySchema = z.object({ fileName: z.string() })

export const POST = internalApiRoute(
  'base-corpus-upload-url',
  async ({ request }) => {
    const { fileName } = await parseJsonBody(request, bodySchema)
    return presignBaseCorpusUpload(fileName)
  },
  { tenancy: { crossTenant: 'the platform base corpus — reads no tenant rows' } }
)
