/**
 * The base corpus's entry of a signed collection scope: the one rule for which countries it carries
 * (ADR-0173). The agent tier reads a base entry without `countries` as a request that says nothing and
 * reads no base chunk, so every producer that signs the base collection names the office's countries here:
 * the main request (`collection-scope-request.ts`) and the callers that sign a few collections by hand
 * (similar passages, grouped semantic search).
 */

import 'server-only'
import { corpusCountriesFor } from '@/lib/base-knowledge/context/corpus-countries'
import { resolveBaseCollectionName, type ScopedCollection } from './collection-scope'

/**
 * The countries a request may read of the base corpus: the office's entitled countries, none for a
 * request with no organization (an anonymous deployment). Never absent: absence reads as "says nothing".
 */
export async function baseCorpusCountries(organizationId: string | null | undefined): Promise<string[]> {
  return organizationId ? corpusCountriesFor(organizationId) : []
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
