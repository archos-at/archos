/**
 * The base corpus's entry of a signed collection scope: the one rule for which countries it carries
 * (ADR-0173). The agent tier reads a base entry without `countries` as a request that says nothing and
 * reads no base chunk, so every producer that signs the base collection names the office's countries here:
 * the main request (`collection-scope-request.ts`) and the callers that sign a few collections by hand
 * (similar passages, grouped semantic search).
 */

import 'server-only'
import { corpusCountriesFor } from '@/lib/base-knowledge/context/corpus-countries'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { resolveBaseCollectionName, type ScopedCollection } from './collection-scope'

/**
 * The countries a request may read of the base corpus: the office's entitled countries, none for a
 * request with no organization (an anonymous deployment). Never absent: absence reads as "says nothing".
 */
export async function baseCorpusCountries(organizationId: string | null | undefined): Promise<string[]> {
  return organizationId ? corpusCountriesFor(organizationId) : []
}

/**
 * The countries a project's request may read of the base corpus: the office's, narrowed to the ones the
 * project's own knowledge context reads (ADR-0173, `retrieval.countries`). Signing the narrowed list holds
 * for every reader of the scope, a turn or run that binds its context and a door, proxy or job read that
 * binds none: a project placed where the office holds no country reads none, an unplaced one reads the
 * office's countries as information (`site_unknown`). A context that cannot be read narrows to none.
 */
export async function projectCorpusCountries(organizationId: string | null | undefined, projectId: string): Promise<string[]> {
  const office = await baseCorpusCountries(organizationId)
  if (!organizationId || office.length === 0) return office
  const site = new Set((await contextForPage(organizationId, projectId)).retrieval.countries)
  return office.filter((country) => site.has(country))
}

/** `names` as signed scope entries: the base collection carries its shelf and countries, the rest stay bare names. */
export async function signedScopeEntries(
  names: readonly string[],
  organizationId: string | null | undefined,
): Promise<Array<string | ScopedCollection>> {
  const base = resolveBaseCollectionName()
  if (!names.includes(base)) return [...names]
  const countries = await baseCorpusCountries(organizationId)
  return names.map((name) => (name === base ? { collection: base, shelf: 'base' as const, countries } : name))
}
