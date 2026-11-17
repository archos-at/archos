import 'server-only'
import { corpusCountriesFor } from '@/lib/base-knowledge/context/corpus-countries'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { resolveBaseCollectionName, type ScopedCollection } from './collection-scope'

export async function baseCorpusCountries(organizationId: string | null | undefined): Promise<string[]> {
  return organizationId ? corpusCountriesFor(organizationId) : []
}

export async function projectCorpusCountries(organizationId: string | null | undefined, projectId: string): Promise<string[]> {
  const office = await baseCorpusCountries(organizationId)
  if (!organizationId || office.length === 0) return office
  const site = new Set((await contextForPage(organizationId, projectId)).retrieval.countries)
  return office.filter((country) => site.has(country))
}

export async function signedScopeEntries(
  names: readonly string[],
  organizationId: string | null | undefined,
): Promise<Array<string | ScopedCollection>> {
  const base = resolveBaseCollectionName()
  if (!names.includes(base)) return [...names]
  const countries = await baseCorpusCountries(organizationId)
  return names.map((name) => (name === base ? { collection: base, shelf: 'base' as const, countries } : name))
}
