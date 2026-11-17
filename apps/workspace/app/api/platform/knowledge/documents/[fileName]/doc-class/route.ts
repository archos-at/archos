import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { updateKnowledgeBaseDocClass } from '@/lib/knowledge/service'
import { knowledgeDocClassSchema } from '@/lib/platform/platform-wire'

export const PATCH = platformApiRoute<{ fileName: string }>(
  async ({ request, params }) => {
    const { fileName } = params
    const body = knowledgeDocClassSchema.safeParse(await request.json().catch(() => null))
    const docClass = body.success ? body.data.doc_class : ''
    if (!docClass) {
      return NextResponse.json(
        { error: 'A doc_class is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    await updateKnowledgeBaseDocClass(fileName, docClass)
    return NextResponse.json({ fileName, docClass })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
