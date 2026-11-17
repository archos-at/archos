import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { searchBodySchema, searchScopeQuerySchema, type SearchBody, type SearchScopeQuery } from './search-wire'

export const SAVED_SEARCH_NAME_MAX = 120
export const SAVED_SEARCH_QUERY_MAX_BYTES = 12_000
export const SAVED_SEARCHES_PER_PERSON_MAX = 200

const nameSchema = z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX).describe('Unique among your own saved searches.')

export const savedSearchQuerySchema = searchBodySchema
  .omit({ cursor: true })
  .refine((query) => new TextEncoder().encode(JSON.stringify(query)).length <= SAVED_SEARCH_QUERY_MAX_BYTES, {
    message: `The question is larger than ${SAVED_SEARCH_QUERY_MAX_BYTES} bytes`,
  })

const savedSearchQueryInput = z.record(z.string(), z.unknown()).transform((value, ctx) => {
  const parsed = savedSearchQuerySchema.safeParse(value)
  if (parsed.success) return parsed.data
  for (const issue of parsed.error.issues) ctx.addIssue({ ...issue })
  return z.NEVER
})

export const createSavedSearchSchema = z.object({
  name: nameSchema,
  scope: searchScopeQuerySchema.describe('Where to look, as workspace-search takes it in its query; {} is the whole office.'),
  query: savedSearchQueryInput.describe(
    'The question: the body of workspace-search (text, kinds, filters, annotationFilters, sort, dir, limit, facets), without a cursor.'
  ),
  shared: z.boolean().default(false).describe('Every member of the office sees and runs it, each with their own rights.'),
})
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>

export const updateSavedSearchSchema = z
  .object({
    name: nameSchema.optional(),
    shared: z.boolean().optional(),
  })
  .refine((patch) => patch.name !== undefined || patch.shared !== undefined, { message: 'Pass name or shared' })
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>

export const listSavedSearchesQuerySchema = z.object({ ...pageQueryShape })
export type ListSavedSearchesQuery = z.infer<typeof listSavedSearchesQuerySchema>

export const savedSearchParamsSchema = z.object({
  id: z.guid().describe('The saved search id, from saved-search-list.'),
})

export interface SavedSearchView {
  id: string
  name: string
  scope: SearchScopeQuery
  query: SearchBody
  shared: boolean
  ownedByMe: boolean
  ownerName: string | null
  createdAt: string
}

export interface SavedSearchListResponse {
  savedSearches: SavedSearchView[]
  nextCursor: string | null
}
