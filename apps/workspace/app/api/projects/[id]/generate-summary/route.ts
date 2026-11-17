import { apiRoute } from '@/lib/api/handler'
import { generateProjectSummary } from '@/lib/project-profile/profile-service'
import { generateSummaryRequestSchema } from '@/lib/project-profile/profile-wire'

export const POST = apiRoute<{ id: string }>(
  async ({ session, params, request }) => {
    const parsed = generateSummaryRequestSchema.safeParse(await request.json().catch(() => null))
    return generateProjectSummary(session, params.id, { locale: parsed.success ? parsed.data.locale : undefined })
  },
  { authz: { enforcedBy: 'generateProjectSummary (requireProjectAccess project:edit)' } }
)
