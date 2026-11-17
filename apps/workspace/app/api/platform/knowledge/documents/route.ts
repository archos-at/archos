import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { refuseReplacingNamedTexts } from '@/lib/base-knowledge/platform/texts'
import { uploadedPdfHashes } from '@/lib/base-knowledge/platform/upload-hashes'
import { getKnowledgeBaseStatus, uploadKnowledgeBaseDocument } from '@/lib/knowledge/service'
import { corpusQuerySchema, narrowCorpus } from '@/lib/knowledge/corpus-query'
import { parseQuery } from '@/lib/api/handler'

export const GET = platformApiRoute(async ({ request }) => narrowCorpus(await getKnowledgeBaseStatus(), parseQuery(request, corpusQuerySchema)), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})

export const POST = platformApiRoute(
  async ({ request }) => {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'A PDF or ZIP file is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }
    const docClassField = form?.get('doc_class')
    const docClass =
      typeof docClassField === 'string' && docClassField.trim() ? docClassField.trim() : undefined

    await refuseReplacingNamedTexts(await uploadedPdfHashes(file))
    const result = await uploadKnowledgeBaseDocument(file, { docClass })
    const ok = result.status === 'pending' || result.status === 'success'
    return NextResponse.json(result, { status: ok ? 200 : 502 })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
