import { z } from 'zod'
import { findIntakeQuestion } from '@/lib/project-profile/intake-conditions'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { foldDiacritics, latinize } from '@/lib/text/latinize'
import { GEOCODE_DEFAULT_LIMIT, GEOCODE_MAX_LIMIT, type GeocodeKind, type GeocodeResult } from './types'

const AUSTRIA_BBOX = '9.53,46.37,17.16,49.02'

const PHOTON_TIMEOUT_MS = 4_000

const MAX_REDIRECTS = 2

export const PHOTON_USER_AGENT = 'architecture-workspace-address-search/1.0'

const LAND_OPTIONS: ReadonlyArray<{ token: string; keys: string[] }> = (
  findIntakeQuestion(projectIntakeDefinitionV1, 'A2_land')?.options ?? []
)
  .filter((option) => option.value !== 'outside_austria')
  .map((option) => ({ token: option.value, keys: [...matchKeys(option.label), option.value] }))

function matchKeys(value: string): string[] {
  const squash = (spelled: string) => spelled.toLowerCase().replace(/\s+/g, ' ').trim()
  return [squash(latinize(value)), squash(foldDiacritics(value))]
}

function federalStateToken(state: string | null): string | null {
  if (!state) return null
  const keys = matchKeys(state)
  return LAND_OPTIONS.find((option) => option.keys.some((key) => keys.includes(key)))?.token ?? null
}

const text = z.string().trim().min(1).optional().catch(undefined)

const featureSchema = z.object({
  properties: z.object({
    type: text,
    name: text,
    street: text,
    housenumber: text,
    city: text,
    state: text,
    postcode: text,
    countrycode: text,
  }),
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
  }),
})

const collectionSchema = z.object({ features: z.array(z.unknown()) })

type Properties = z.infer<typeof featureSchema>['properties']

function kindOf(properties: Properties): GeocodeKind {
  if (properties.housenumber) return 'address'
  return properties.type === 'street' ? 'street' : 'place'
}

function municipalityOf(properties: Properties): string | null {
  if (properties.city) return properties.city
  return properties.type === 'city' ? (properties.name ?? null) : null
}

function labelOf(properties: Properties, municipality: string | null): string | null {
  const place = [properties.postcode, municipality].filter(Boolean).join(' ')
  const firstLine = properties.housenumber
    ? [properties.street ?? properties.name, properties.housenumber].filter(Boolean).join(' ')
    : properties.type === 'city' && municipality === properties.name
      ? undefined
      : (properties.name ?? properties.street)
  const label = [firstLine, place].filter(Boolean).join(', ')
  return label || null
}

function toResult(raw: unknown): GeocodeResult | null {
  const feature = featureSchema.safeParse(raw)
  if (!feature.success) return null
  const { properties, geometry } = feature.data
  if (properties.countrycode?.toUpperCase() !== 'AT') return null

  const [lon, lat] = geometry.coordinates
  const municipality = municipalityOf(properties)
  const label = labelOf(properties, municipality)
  if (!label || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null

  const federalState =
    federalStateToken(properties.state ?? null) ?? (municipality && federalStateToken(municipality) === 'vienna' ? 'vienna' : null)
  const state = properties.state ?? (federalState === 'vienna' ? 'Wien' : null)

  return {
    label,
    lat,
    lon,
    country: 'at',
    federalState,
    state,
    municipality,
    postcode: properties.postcode ?? null,
    kind: kindOf(properties),
  }
}

export function parsePhotonResponse(json: unknown): GeocodeResult[] {
  const collection = collectionSchema.safeParse(json)
  if (!collection.success) return []
  const seen = new Set<string>()
  const results: GeocodeResult[] = []
  for (const raw of collection.data.features) {
    const result = toResult(raw)
    if (!result || seen.has(result.label)) continue
    seen.add(result.label)
    results.push(result)
  }
  return results
}

export interface PhotonSearchOptions {
  limit?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

function photonUrl(baseUrl: string, query: string, limit: number): URL {
  const url = new URL('api/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(limit * 2, GEOCODE_MAX_LIMIT * 2)))
  url.searchParams.set('lang', 'de')
  url.searchParams.set('bbox', AUSTRIA_BBOX)
  return url
}

async function fetchSameOrigin(url: URL, signal: AbortSignal, fetchImpl: typeof fetch): Promise<Response> {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(target, {
      headers: { accept: 'application/json', 'user-agent': PHOTON_USER_AGENT },
      redirect: 'manual',
      signal,
    })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    const next = new URL(location, target)
    if (next.origin !== url.origin) throw new Error(`redirect to another origin refused (${next.origin})`)
    target = next
  }
  throw new Error('too many redirects')
}

export async function searchPhoton(
  baseUrl: string,
  query: string,
  options: PhotonSearchOptions = {},
): Promise<GeocodeResult[]> {
  const limit = options.limit ?? GEOCODE_DEFAULT_LIMIT
  const timeout = AbortSignal.timeout(PHOTON_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  try {
    const response = await fetchSameOrigin(photonUrl(baseUrl, query, limit), signal, options.fetchImpl ?? fetch)
    if (!response.ok) {
      console.error(`[geocode] photon answered ${response.status}`)
      return []
    }
    return parsePhotonResponse(await response.json()).slice(0, limit)
  } catch (error) {
    console.error('[geocode] photon search failed', error instanceof Error ? error.message : error)
    return []
  }
}
