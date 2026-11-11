/**
 * Platform knowledge management — upload a PDF (or a ZIP of PDFs) into the
 * shared base corpus (ADR-0016). Platform owners only. The backend ingests in
 * the background, so a successful accept returns `pending` (HTTP 200); the UI
 * polls the corpus status for the terminal lifecycle. An optional `doc_class`
 * form field pre-sets the Dokumentart for a single-PDF upload.
 *
 * Other bytes under a file a platform record names are refused (409
 * `NAME_TAKEN`, ADR-0165): the bytes a reviewer read are the bytes a publish
 * indexes, so a named text changes only in a change request.
 */

import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { refuseReplacingNamedTexts } from '@/lib/base-knowledge/platform/texts'
import { uploadedPdfHashes } from '@/lib/base-knowledge/platform/upload-hashes'
import { uploadKnowledgeBaseDocument } from '@/lib/knowledge/service'

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
    // Ingestion is backgrounded: 'pending' (accepted) and 'success' are OK;
    // only a terminal 'failed'/'timeout' maps to a gateway error the UI surfaces.
    const ok = result.status === 'pending' || result.status === 'success'
    return NextResponse.json(result, { status: ok ? 200 : 502 })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
