/**
 * Today in the legislating node's zone (design §3.6). Pure, given the clock.
 *
 * Only a procedure that is still open reads today: its window runs to now. A
 * node whose country has no zone here gets none, and the resolver answers
 * `zone_unknown` rather than taking the server's day.
 */

/** The zone of each country a node may legislate in; one zone per country is true for every country listed. */
const ZONE_BY_COUNTRY: Readonly<Record<string, string>> = {
  AT: 'Europe/Vienna',
  DE: 'Europe/Berlin',
  CH: 'Europe/Zurich',
  LI: 'Europe/Vaduz',
  IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam',
  LU: 'Europe/Luxembourg',
  BE: 'Europe/Brussels',
}

/** The zone of a territory id (`AT-9`, `AT:gkz:90001`, `DE`), or null for a node with none listed. */
export function zoneOf(territoryId: string): string | null {
  const country = /^([A-Z]{2})(?:$|[-:])/.exec(territoryId)?.[1]
  return country ? (ZONE_BY_COUNTRY[country] ?? null) : null
}

/** The calendar day `now` falls on in `zone`, as an ISO date. */
export function dayIn(zone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
