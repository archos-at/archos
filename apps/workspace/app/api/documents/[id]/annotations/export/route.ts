import { NextResponse } from 'next/server'
import { apiRoute, parseQuery } from '@/lib/api/handler'
import { exportAnnotationProtocol } from '@/lib/annotations/export'
import { annotationExportQuerySchema } from '@/lib/annotations/export-request'
import { contentDisposition } from '@/lib/documents/content-disposition'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const options = parseQuery(request, annotationExportQuerySchema)
    const file = await exportAnnotationProtocol(session, params.id, options, request)
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mediaType,
        'Content-Disposition': contentDisposition('attachment', file.filename),
        'Cache-Control': 'no-store',
      },
    })
  },
  { authz: { enforcedBy: 'exportAnnotationProtocol -> getAccessibleDocument (read) + listAnnotations' } }
)
