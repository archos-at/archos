import 'server-only'

import { searchPhoton } from './photon'
import type { GeocodeQuery, GeocodeResponse } from './types'

function geocoderUrl(): string | null {
  const raw = process.env.GEOCODER_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    // fall through to the warning
  }
  console.error('[geocode] GEOCODER_URL is not an http(s) URL; the geocoder stays off')
  return null
}

export async function searchAddresses(query: GeocodeQuery, signal?: AbortSignal): Promise<GeocodeResponse> {
  const baseUrl = geocoderUrl()
  if (!baseUrl) return { enabled: false, results: [] }
  return { enabled: true, results: await searchPhoton(baseUrl, query.q, { limit: query.limit, signal }) }
}
