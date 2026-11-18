import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError, PayloadTooLargeError } from '@/lib/api/errors'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { getLocale } from '@/i18n/server'
import { MAX_DIAGRAM_SOURCE_BYTES, MAX_DIAGRAM_SVG_BYTES } from '@/lib/diagrams/diagram-sources'
import { fileDiagramSchema } from '@/lib/diagrams/diagram-wire'
import { DiagramSvgError } from '@/lib/diagrams/svg'
import { fileDiagramDocuments } from '@/lib/diagrams/filing'
import { recordDiagramScore } from '@/lib/langfuse/diagram-score'
import { requireResourceAccess } from '@/lib/sharing/access'

type Params = { id: string }

const MAX_DIAGRAM_REQUEST_BYTES = 2 * (MAX_DIAGRAM_SVG_BYTES + MAX_DIAGRAM_SOURCE_BYTES) + 8 * 1024

function refuseOversizedBody(request: Request): void {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DIAGRAM_REQUEST_BYTES) {
    throw new PayloadTooLargeError(MAX_DIAGRAM_REQUEST_BYTES)
  }
}

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    refuseOversizedBody(request)
    const body = await parseJsonBody(request, fileDiagramSchema)
    const locale = await getLocale()
    const diagrams = diagramsCopy.messages[locale]
    if (body.conversationId) {
      await requireResourceAccess(session, 'conversation', body.conversationId, 'viewer')
    }

    try {
      const filed = await fileDiagramDocuments({
        session,
        projectId: params.id,
        answerRef: body.runId,
        title: body.title,
        sourceKind: body.sourceKind,
        source: body.source,
        svg: body.svg,
        marking: body.edited
          ? diagrams.markingEdited
          : body.sourceKind === 'excalidraw'
            ? diagrams.markingSketch
            : diagrams.marking,
        request,
        origin: body.conversationId ? { conversationId: body.conversationId, locale } : undefined,
      })
      void recordDiagramScore({
        organizationId: session.organizationId,
        answerId: body.answerId ?? null,
        documentId: filed.svg.documentId,
        edited: body.edited === true,
      })
      return { svg: filed.svg, pdf: filed.pdf }
    } catch (error) {
      if (error instanceof DiagramSvgError) {
        throw new BadRequestError(diagrams.rejected[error.rejection])
      }
      throw error
    }
  },
  {
    status: 201,
    authz: {
      enforcedBy:
        'fileDiagramDocuments → fileGeneratedDocument (requireProjectAccess project:documents:write AND project:documents:generate, plus the agent-authored-documents flag); with a conversationId, requireResourceAccess conversation viewer and the restricted-folder filing refusal',
    },
  }
)
