import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { createCredentialSchema } from '@/lib/llm-credentials/credential-wire'
import {
  activeSecretBackend,
  createCredential,
  getLlmProviderMode,
  listOrgCredentials,
} from '@/lib/llm-credentials/service'

export const GET = apiRoute(
  async ({ session }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.byokLlm)
    if (gated) return gated
    const [credentials, mode] = await Promise.all([
      listOrgCredentials(session.organizationId),
      getLlmProviderMode(session.organizationId),
    ])
    return {
      credentials,
      mode,
      secretBackend: activeSecretBackend(),
    }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.byokLlm)
    if (gated) return gated
    const input = await parseJsonBody(request, createCredentialSchema)
    return { credential: await createCredential(session, input, request) }
  },
  { status: 201, authz: { permission: ORG_PERMISSIONS.modelsManage } }
)
