import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { narrowedTo, structuredQuery } from './document-search'
import { reachFor, resolveScope } from './reach'
import {
  SUGGEST_LIMIT,
  type DocumentFilters,
  type SearchScopeQuery,
  type SuggestBody,
  type SuggestDimension,
  type SuggestResponse,
} from './search-wire'
import { suggestValues } from './suggest-repository'

export function filtersBeside(
  filters: DocumentFilters,
  dimension: SuggestDimension,
  factKey?: string
): DocumentFilters {
  const { parties, place, municipalities, cites, scale, planNumber, planIndex, facts, ...rest } =
    filters
  const kept: DocumentFilters = { ...rest }
  if (dimension !== 'party' && parties) kept.parties = parties
  if (dimension !== 'place') {
    if (place) kept.place = place
    if (municipalities) kept.municipalities = municipalities
  }
  if (dimension !== 'cites' && cites) kept.cites = cites
  if (dimension !== 'scale' && scale) kept.scale = scale
  if (dimension !== 'planNumber' && planNumber) kept.planNumber = planNumber
  if (dimension !== 'planIndex' && planIndex) kept.planIndex = planIndex
  const otherFacts = dimension === 'fact' ? facts?.filter((fact) => fact.key !== factKey) : facts
  if (otherFacts?.length) kept.facts = otherFacts
  return kept
}

export async function runSuggest(
  session: AuthorizedSession,
  scopeQuery: SearchScopeQuery,
  body: SuggestBody
): Promise<SuggestResponse> {
  const filters = filtersBeside(body.filters ?? {}, body.dimension, body.factKey)
  const reach = narrowedTo(await reachFor(session, resolveScope(scopeQuery)), { filters })
  const documents = await structuredQuery(reach, filters)
  if (!documents) return { dimension: body.dimension, values: [] }
  const values = await suggestValues(
    reach,
    { ...documents, text: null },
    {
      dimension: body.dimension,
      prefix: body.prefix ?? '',
      role: body.role,
      factKey: body.factKey,
      limit: SUGGEST_LIMIT,
    }
  )
  return { dimension: body.dimension, values }
}
