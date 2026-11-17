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

export function zoneOf(chain: readonly string[], zones: Readonly<Record<string, string>>): string | null {
  for (const territoryId of chain) if (zones[territoryId]) return zones[territoryId]
  const country = /^([A-Z]{2})(?:$|[-:])/.exec(chain[0] ?? '')?.[1]
  return country ? (ZONE_BY_COUNTRY[country] ?? null) : null
}

export function dayIn(zone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
