import { geocodeResponseSchema, type GeocodeResponse } from './types'

export type GeocodingFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: GeocodingFetch = (path, init) => fetch(path, init)

export class GeocodingRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GeocodingRequestError'
  }
}

export const GEOCODE_PATH = '/api/geocode'

export interface GeocodingClient {
  search(q: string, limit?: number, init?: Pick<RequestInit, 'signal'>): Promise<GeocodeResponse>
}

export function createGeocodingClient(fetchImpl: GeocodingFetch = defaultFetch): GeocodingClient {
  return {
    async search(q, limit, init) {
      const params = new URLSearchParams({ q })
      if (limit !== undefined) params.set('limit', String(limit))
      const response = await fetchImpl(`${GEOCODE_PATH}?${params}`, { method: 'GET', signal: init?.signal })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const error = (body ?? {}) as { error?: string; code?: string }
        throw new GeocodingRequestError(
          response.status,
          error.code ?? 'UNKNOWN',
          error.error ?? `Request failed with ${response.status}`,
        )
      }
      return geocodeResponseSchema.parse(body)
    },
  }
}
