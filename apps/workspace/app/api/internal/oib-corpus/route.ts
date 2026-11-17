import { internalApiRoute } from '@/lib/api/handler'
import { streamKnowledgeBaseCorpus } from '@/lib/knowledge/service'

export const GET = internalApiRoute('oib-corpus', async () => streamKnowledgeBaseCorpus(), {
  tenancy: { crossTenant: 'the platform base corpus — reads no tenant rows' },
  tokenEnv: 'CORPUS_EXPORT_TOKEN',
})
