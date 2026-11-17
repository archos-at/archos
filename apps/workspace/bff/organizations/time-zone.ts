import 'server-only'
import { getCached } from '@/lib/cache'
import { OFFICE_TIME_ZONE } from '@/lib/format'
import { currentMonth, type Month } from '@/lib/projects/month'
import { findOrganization } from './repository'

const TIME_ZONE_CACHE_TTL_MS = 300_000
const timeZoneCacheKey = (organizationId: string): string => `org:${organizationId}:time-zone`

export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export async function officeTimeZone(organizationId: string): Promise<string> {
  let zone: string | null
  try {
    zone = await getCached(timeZoneCacheKey(organizationId), TIME_ZONE_CACHE_TTL_MS, async () => {
      const row = await findOrganization(organizationId)
      return row?.timeZone ?? null
    })
  } catch (error) {
    console.warn('[organizations] time zone unreadable, using Europe/Vienna:', error instanceof Error ? error.message : error)
    zone = null
  }
  return zone && isKnownTimeZone(zone) ? zone : OFFICE_TIME_ZONE
}

export async function officeMonth(organizationId: string, now: Date = new Date()): Promise<Month> {
  return currentMonth(now, await officeTimeZone(organizationId))
}
