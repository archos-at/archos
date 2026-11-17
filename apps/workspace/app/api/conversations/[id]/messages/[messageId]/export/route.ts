import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { exportAnswerDocument } from '@/lib/answer-export/service'

type Params = { id: string; messageId: string }

const messageIdSchema = z.guid()

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')

    const document = await exportAnswerDocument(session, params.id, messageId.data)

    return new NextResponse(new Uint8Array(document.bytes), {
      status: 200,
      headers: {
        'Content-Type': document.mediaType,
        'Content-Disposition': `attachment; filename="${document.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
  { authz: { enforcedBy: 'exportAnswerDocument (requireResourceAccess on the conversation)' } }
)
