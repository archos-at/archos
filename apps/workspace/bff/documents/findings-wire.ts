import { z } from 'zod'
import type { DocumentFinding, IncomingReference, ResolvedReference } from './findings'

export const documentFindingsQuerySchema = z.object({
  documentId: z
    .string()
    .guid()
    .optional()
    .describe(
      "A document id from document-list. With it, `document` carries that document's references resolved to the " +
        "project's documents and the documents that point at it."
    ),
})

export type DocumentFindingsQuery = z.infer<typeof documentFindingsQuerySchema>

export interface DocumentLinks {
  references: ResolvedReference[]
  referencedBy: IncomingReference[]
}

export interface DocumentFindingsResponse {
  findings: DocumentFinding[]
  documentCount: number
  truncated: boolean
  document: DocumentLinks | null
}
