import 'server-only'
import {
  fileGeneratedDocument,
  generatedDocumentMarking,
  type FiledGeneratedDocument,
} from '@/lib/documents/generated'
import type { ConversationOrigin } from '@/lib/conversations/restricted-egress'
import type { AuthorizedSession } from '@/lib/auth/types'
import { acceptDiagram, censusSvg, type DiagramSubmission } from './svg'
import { renderDiagramPdf } from './svg-to-pdf'

export interface FileDiagramInput extends DiagramSubmission {
  session: AuthorizedSession
  projectId: string
  answerRef: string
  title: string
  marking: string
  request?: Request
  origin?: ConversationOrigin
}

export interface FiledDiagram {
  svg: FiledGeneratedDocument
  pdf: FiledGeneratedDocument | null
}

export async function fileDiagramDocuments(input: FileDiagramInput): Promise<FiledDiagram> {
  const provenance = generatedDocumentMarking('diagram_svg', input.answerRef)
  const accepted = acceptDiagram(input, { notice: input.marking, provenance })
  const svgBytes = new TextEncoder().encode(accepted.svg)

  const svg = await fileGeneratedDocument({
    session: input.session,
    projectId: input.projectId,
    producer: 'diagram_svg',
    ref: input.answerRef,
    title: input.title,
    request: input.request,
    origin: input.origin,
    render: ({ marking }) => ({ bytes: svgBytes, contentType: 'image/svg+xml', marking }),
  })

  try {
    const pdf = await fileGeneratedDocument({
      session: input.session,
      projectId: input.projectId,
      producer: 'diagram_pdf',
      ref: input.answerRef,
      title: input.title,
      request: input.request,
    origin: input.origin,
      render: async (context) => ({
        bytes: await renderDiagramPdf({
          root: accepted.root,
          viewport: accepted.viewport,
          title: input.title,
          projectName: context.projectName,
          marking: input.marking,
          provenance: context.marking,
          createdAt: new Date(),
        }),
        contentType: 'application/pdf',
        marking: context.marking,
      }),
    })
    return { svg, pdf }
  } catch (error) {
    console.error('[diagrams] the SVG was filed and the PDF was not', {
      projectId: input.projectId,
      answerRef: input.answerRef,
      svgDocumentId: svg.documentId,
      cause: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
      svgBytes: accepted.svg.length,
      viewport: { ...accepted.viewport },
      census: censusSvg(accepted.root),
    })
    return { svg, pdf: null }
  }
}
