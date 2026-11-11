/**
 * Platform knowledge management — remove an admin-uploaded PDF from the
 * shared base corpus (source file, registry entry, indexed chunks).
 * Platform owners only. Repo-shipped corpus files cannot be deleted, and
 * neither can a file a platform record names as its text (409): its publish
 * or its next re-index would find no file (ADR-0165).
 *
 * GET streams the PDF of any file the corpus lists, released or not, for the
 * viewer of the platform's knowledge page. An office reads only what is
 * released to it, through `GET /api/knowledge-base/documents/[fileName]`.
 * Platform staff with `platform:settings:view`.
 */

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
    // One name for the check and the removal: the service trims what it is given, so a name checked as it arrived
    // (a leading space, another normal form) once passed the check and then removed the file a record names.
    const fileName = params.fileName.trim()
    await refuseRemovingNamedText(fileName)
    await deleteKnowledgeBaseDocument(fileName)
    return NextResponse.json({ success: true, fileName })
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite }
)
