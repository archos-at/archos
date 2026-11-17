import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import { getWorkOS } from '@/lib/workos/client'
import { homeCountrySchema, type HomeCountry } from './home-country'
import { createOrganizationRow, findOrganization, placeOrganization } from './repository'

const placed = new Set<string>()
const warned = new Set<string>()
const unplacedUntil = new Map<string, number>()
export const UNPLACED_RECHECK_MS = 5 * 60_000

export function homeCountryFromMetadata(metadata: Record<string, unknown> | null | undefined): HomeCountry | null {
  const raw = metadata?.home_country
  const parsed = homeCountrySchema.safeParse(typeof raw === 'string' ? raw.trim().toUpperCase() : raw)
  return parsed.success ? parsed.data : null
}

export async function homeCountryFromDirectory(organizationId: string): Promise<HomeCountry | null> {
  try {
    const organization = await getWorkOS().organizations.getOrganization(organizationId)
    return homeCountryFromMetadata(organization.metadata)
  } catch {
    return null
  }
}

function warnUnplaced(organizationId: string): void {
  if (warned.has(organizationId)) return
  warned.add(organizationId)
  console.warn(
    `[organizations] ${organizationId} has no home country: its clock falls back to Europe/Vienna until an admin ` +
      'states it (organization page) or the WorkOS organization carries metadata home_country (ADR-0158)'
  )
}

export async function ensureOrganizationRow(organizationId: string, now: number = Date.now()): Promise<void> {
  if (placed.has(organizationId) || (unplacedUntil.get(organizationId) ?? 0) > now) return
  try {
    const row = await findOrganization(organizationId)
    if (row?.homeCountry) {
      placed.add(organizationId)
      return
    }
    const fromDirectory = await homeCountryFromDirectory(organizationId)
    if (fromDirectory) {
      await placeOrganization(organizationId, fromDirectory)
      placed.add(organizationId)
      return
    }
    if (!row) await createOrganizationRow(organizationId)
    unplacedUntil.set(organizationId, now + UNPLACED_RECHECK_MS)
    warnUnplaced(organizationId)
  } catch (error) {
    console.warn(`[organizations] could not ensure the row of ${organizationId}:`, error)
  }
}

export async function stateHomeCountry(organizationId: string, homeCountry: HomeCountry): Promise<void> {
  const row = await findOrganization(organizationId)
  if (row?.homeCountry && row.homeCountry !== homeCountry) {
    throw new ConflictError(`The home country is already ${row.homeCountry}; it is stated once and not changed here.`)
  }
  if (row?.homeCountry !== homeCountry) await placeOrganization(organizationId, homeCountry)
  placed.add(organizationId)
  unplacedUntil.delete(organizationId)
}
