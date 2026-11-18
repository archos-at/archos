import { internalApiRoute } from '@/lib/api/handler'
import { deleteBaseCorpusObject } from '@/lib/knowledge/base-corpus-storage'

type Params = { fileName: string }

export const DELETE = internalApiRoute<Params>(
  'base-corpus-delete',
  async ({ params }) => deleteBaseCorpusObject(params.fileName),
  { tenancy: { crossTenant: 'the platform base corpus — reads no tenant rows' } }
)
