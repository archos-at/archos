import { z } from 'zod'
import type { RevisionTag } from '@/lib/documents/revision-timeline'
import type { ProjectStatus } from '@/lib/cross-project/types'

export const SIMILAR_PASSAGE_TEXT_MAX = 4000
export const SIMILAR_PASSAGE_TEXT_MIN = 12

const sourceDocumentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stored'), documentId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('base'), fileName: z.string().min(1).max(500) }),
])

export const similarPassagesRequestSchema = z.object({
  document: sourceDocumentSchema,
  passage: z.object({
    text: z.string().trim().min(SIMILAR_PASSAGE_TEXT_MIN).max(SIMILAR_PASSAGE_TEXT_MAX),
    page: z.number().int().min(1).nullable().optional(),
    cited: z.boolean(),
  }),
  projectId: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe(
      'The project the person is working in, listed first as the current group. It does not narrow the search, which covers every project the person may read; a stored project document names its own project instead.'
    ),
})

export type SimilarPassagesRequest = z.infer<typeof similarPassagesRequestSchema>
export type SimilarSourceDocument = SimilarPassagesRequest['document']

export interface SimilarPassage {
  page: number | null
  snippet: string
  score: number
}

export interface SimilarDocument {
  documentId: string
  filename: string
  displayName: string | null
  contentType: string | null
  stand: RevisionTag | null
  passages: SimilarPassage[]
}

export type SimilarGroupKind = 'current' | 'project' | 'office_shelf'

export interface SimilarGroup {
  kind: SimilarGroupKind
  project: { id: string; name: string; status: ProjectStatus } | null
  documents: SimilarDocument[]
}

export interface SimilarPassagesResponse {
  groups: SimilarGroup[]
  projectsSearched: number
  origin: 'point' | 'embedded'
}

export const similarDocumentsOf = (response: SimilarPassagesResponse): SimilarDocument[] =>
  response.groups.flatMap((group) => group.documents)
