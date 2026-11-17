/**
 * The office's clock: `organizations.time_zone` (migration 0200), the
 * replacement for the one constant `OFFICE_TIME_ZONE` wherever an organization
 * is in scope. A row without one, or no row, reads as `OFFICE_TIME_ZONE`
 * (Europe/Vienna), the clock every office had before. It is the office's own
 * clock: a project's site never sets it, and it never places a project (ADR-0158).
 *
 * Cached per organization for five minutes: the zone changes about never, and
 * "today" is read on hot paths (the marks list, the document search).
 */

import 'server-only'
import { getCached } from '@/lib/cache'
import { OFFICE_TIME_ZONE } from '@/lib/format'
import { currentMonth, type Month } from '@/lib/projects/month'
import { findOrganization } from './repository'

const TIME_ZONE_CACHE_TTL_MS = 300_000
const timeZoneCacheKey = (organizationId: string): string => `org:${organizationId}:time-zone`

/** Whether the runtime knows `zone` as an IANA time zone. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * The organization's clock, else Europe/Vienna. A zone the runtime does not know
 * is never used. Fails soft: a read that fails answers Europe/Vienna, the clock
 * every office had before the column, because "which day is it" must never fail
 * the request that asked (a marks list, a search, a project close).
 */
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

/** The month it is now on the office's clock. */
export async function officeMonth(organizationId: string, now: Date = new Date()): Promise<Month> {
  return currentMonth(now, await officeTimeZone(organizationId))
}
