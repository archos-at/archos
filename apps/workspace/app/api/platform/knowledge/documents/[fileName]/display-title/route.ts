import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { updateKnowledgeBaseDisplayTitle } from '@/lib/knowledge/service'
import { knowledgeDisplayTitleSchema } from '@/lib/platform/platform-wire'

export const PATCH = platformApiRoute<{ fileName: string }>(
  async ({ request, params }) => {
    const { fileName } = params
    const body = knowledgeDisplayTitleSchema.safeParse(await request.json().catch(() => null))
    const raw = body.success ? (body.data.display_title ?? '').trim() : ''
    const displayTitle = raw || null

    await updateKnowledgeBaseDisplayTitle(fileName, displayTitle)
    return NextResponse.json({ fileName, displayTitle })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
