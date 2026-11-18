import { NextResponse } from 'next/server'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { reingestKnowledgeSchema } from '@/lib/platform/platform-wire'
import { reingestKnowledgeBaseDocuments } from '@/lib/knowledge/service'

export const POST = platformApiRoute(
  async ({ request }) => {
    const { fileNames } = await parseJsonBody(request, reingestKnowledgeSchema)
    const result = await reingestKnowledgeBaseDocuments(fileNames)
    return NextResponse.json(result)
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
