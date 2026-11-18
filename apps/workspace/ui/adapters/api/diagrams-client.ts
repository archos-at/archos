import { z } from 'zod'
import type { fileDiagramSchema } from '@/lib/diagrams/diagram-wire'
import { ApiRequestError } from './api-error'

export type DiagramFilingRequest = z.input<typeof fileDiagramSchema>

export interface FiledDiagram {
  svgDocumentId: string
  pdfFiled: boolean
}

export class DiagramFilingError extends ApiRequestError {
  readonly serverMessage: string | null

  constructor(status: number, serverMessage: string | null) {
    super(`Failed to file the diagram: ${status}`, status)
    this.name = 'DiagramFilingError'
    this.serverMessage = serverMessage
  }
}

const FiledHalfSchema = z.object({ documentId: z.string().min(1) })

const FiledDiagramSchema = z.object({
  svg: FiledHalfSchema,
  pdf: z.unknown(),
})

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

export const fileDiagram = async (projectId: string, request: DiagramFilingRequest): Promise<FiledDiagram> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/diagrams`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const serverMessage =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null
    throw new DiagramFilingError(response.status, serverMessage)
  }
  const parsed = FiledDiagramSchema.safeParse(await response.json())
  if (!parsed.success) throw new DiagramFilingError(response.status, null)
  return {
    svgDocumentId: parsed.data.svg.documentId,
    pdfFiled: FiledHalfSchema.safeParse(parsed.data.pdf).success,
  }
}
