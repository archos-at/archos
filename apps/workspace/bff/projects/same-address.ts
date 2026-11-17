import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { distanceMetres, normalizeAddress } from '@/lib/text/address-match'
import { listProjectAddressesInOrg, type ProjectAddressRow } from './repository'
import { projectsHolding } from './service'
import type { ProjectStatus } from './project-status'

export const SAME_ADDRESS_RADIUS_M = 50
export const SAME_ADDRESS_LIMIT = 3

export interface SameAddressQuery {
  label: string
  lat?: number | undefined
  lon?: number | undefined
}

export interface SameAddressProject {
  id: string
  name: string
  status: ProjectStatus
}

export function matchSameAddress(
  rows: readonly ProjectAddressRow[],
  query: SameAddressQuery
): ProjectAddressRow[] {
  const wanted = normalizeAddress(query.label)
  const point = query.lat !== undefined && query.lon !== undefined ? { lat: query.lat, lon: query.lon } : null
  const scored: Array<{ row: ProjectAddressRow; rank: number }> = []
  for (const row of rows) {
    if (wanted !== '' && row.address !== null && normalizeAddress(row.address) === wanted) {
      scored.push({ row, rank: 0 })
      continue
    }
    if (point && row.location && distanceMetres(point, row.location) <= SAME_ADDRESS_RADIUS_M) {
      scored.push({ row, rank: 1 })
    }
  }
  return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.row)
}

export async function findProjectsAtAddress(
  session: AuthorizedSession,
  query: SameAddressQuery
): Promise<SameAddressProject[]> {
  const rows = await listProjectAddressesInOrg(session.organizationId)
  const matches = matchSameAddress(rows, query)
  if (matches.length === 0) return []
  const reachable = await projectsHolding(session, matches)
  return reachable
    .slice(0, SAME_ADDRESS_LIMIT)
    .map(({ id, name, status }) => ({ id, name, status }))
}
