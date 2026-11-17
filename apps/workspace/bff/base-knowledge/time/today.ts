/**
 * Today in the legislating node's zone (design §3.6). Pure, given the clock.
 *
 * Only a procedure that is still open reads today: its window runs to now. A
 * node whose chain states no zone, in a country the build lists none for,
 * gets none, and the resolver answers `zone_unknown` rather than taking the
 * server's day.
 */

/** The zone of each country a node may legislate in, for a chain whose released records state none. */
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

/**
 * The zone a node's day is read in: the nearest territory on its chain that
 * states one (the territory record's `zone`, released like any claim); when
 * none does, the build's zone of the leaf's country, or null.
 */
export function zoneOf(chain: readonly string[], zones: Readonly<Record<string, string>>): string | null {
  for (const territoryId of chain) if (zones[territoryId]) return zones[territoryId]
  // Fallback to the compiled zone table until Austria is on stable on prod; deleted by #1630.
  const country = /^([A-Z]{2})(?:$|[-:])/.exec(chain[0] ?? '')?.[1]
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
