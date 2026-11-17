import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { refuseRemovingNamedText } from '@/lib/base-knowledge/platform/texts'
import { deleteKnowledgeBaseDocument } from '@/lib/knowledge/service'
import { streamKnowledgeBaseDocumentAsPlatform } from '@/lib/knowledge/source-pdf'

export const GET = platformApiRoute<{ fileName: string }>(
  async ({ params }) => streamKnowledgeBaseDocumentAsPlatform(params.fileName),
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const DELETE = platformApiRoute<{ fileName: string }>(
  async ({ params }) => {
    const fileName = params.fileName.trim()
    await refuseRemovingNamedText(fileName)
    await deleteKnowledgeBaseDocument(fileName)
    return NextResponse.json({ success: true, fileName })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
