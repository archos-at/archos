import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { providerModeSchema } from '@/lib/llm-credentials/credential-wire'
import { setLlmProviderMode } from '@/lib/llm-credentials/service'

export const PUT = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.byokLlm)
    if (gated) return gated
    const { mode } = await parseJsonBody(request, providerModeSchema)
    return { mode: await setLlmProviderMode(session, mode, request) }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)
