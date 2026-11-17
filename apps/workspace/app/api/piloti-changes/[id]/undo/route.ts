import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { undoChange, UndoRefusedError } from '@/lib/changes/service'
import type { UndoChangeResponse } from '@/lib/changes/types'

type Params = { id: string }

const idSchema = z.guid()

export const POST = apiRoute<Params>(
  async ({ session, params }): Promise<UndoChangeResponse | Response> => {
    const id = idSchema.safeParse(params.id)
    if (!id.success) throw new NotFoundError()
    try {
      return { change: await undoChange(session, id.data) }
    } catch (error) {
      if (!(error instanceof UndoRefusedError)) throw error
      return Response.json(
        { error: error.refusal, message: error.message, code: error.code, details: error.details },
        { status: error.status }
      )
    }
  },
  {
    authz: {
      enforcedBy:
        "undoChange (requireResourceAccess viewer on the turn's conversation + the document's read gate; the inverse through the annotations service's write checks)",
    },
  }
)
