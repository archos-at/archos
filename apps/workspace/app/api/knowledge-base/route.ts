import { apiRoute } from '@/lib/api/handler'
import { getKnowledgeBaseStatusFor } from '@/lib/knowledge/released-corpus'

export const GET = apiRoute(async ({ session }) => getKnowledgeBaseStatusFor(session), {
  authz: {
    sessionOnly: true,
    why: 'needs no permission: every member reads the base corpus. Which files are listed is decided in the service, by the office’s entitled countries and each file’s release mark (lib/knowledge/released-corpus.ts)',
  },
})
