/**
 * Today in the legislating node's zone (design §3.6). Pure, given the clock.
 *
 * Only a procedure that is still open reads today: its window runs to now. A
 * node whose chain states no zone gets none, and the resolver answers
 * `zone_unknown` rather than taking the server's day.
 */

/**
 * The zone a node's day is read in: the nearest territory on its chain that
 * states one (the territory record's `zone`, released like any claim), or
 * null when none does. Never a table in code: a country's zone is data.
 */
export function zoneOf(chain: readonly string[], zones: Readonly<Record<string, string>>): string | null {
  for (const territoryId of chain) if (zones[territoryId]) return zones[territoryId]
  return null
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
