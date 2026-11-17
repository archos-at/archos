import { NextResponse } from 'next/server'
import { apiRoute, parseQuery } from '@/lib/api/handler'
import { exportProjectProtocol } from '@/lib/annotations/project-export'
import { projectProtocolQuerySchema } from '@/lib/annotations/project-types'
import { contentDisposition } from '@/lib/documents/content-disposition'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const file = await exportProjectProtocol(session, params.id, parseQuery(request, projectProtocolQuerySchema), request)
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mediaType,
        'Content-Disposition': contentDisposition('attachment', file.filename),
        'Cache-Control': 'no-store',
      },
    })
  },
  { authz: { enforcedBy: 'exportProjectProtocol -> listProjectAnnotations (requireProjectAccess project:view)' } }
)
