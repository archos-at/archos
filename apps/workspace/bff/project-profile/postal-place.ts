import lines from './austrian-postal-codes.json'

let table: Map<string, Map<string, string>> | null = null

function postalTable(): Map<string, Map<string, string>> {
  if (table) return table
  table = new Map()
  for (const line of lines as readonly string[]) {
    const [code, ...groups] = line.split('|')
    const places = new Map<string, string>()
    for (const group of groups) {
      const [state, keys] = group.split(':')
      for (const key of keys.split(',')) places.set(key, state)
    }
    table.set(code, places)
  }
  return table
}

export function placeKey(name: string): string {
  return name
    .split(',')[0]
    .toLowerCase()
    .replace(/\bpostfach\b/g, '')
    .replace(/\bst\.\s*/g, 'sankt ')
    .replace(/[^a-zäöüß ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

const FOREIGN = /\b(?:schweiz|switzerland|suisse|svizzera|liechtenstein|deutschland|germany|italien|italia|italy|slowenien|slovenia|ungarn|hungary|tschechien|czechia|slowakei|slovakia)\b|(?:^|[\s,])(?:CH|FL|D|DE|I|IT|SLO|SI|H|HU|CZ|SK)-\d/i

function postalPairs(address: string): Array<{ code: string; place: string }> {
  const pairs = [...address.matchAll(/(?:^|[\s,])(?:A-|AT-)?(\d{4})\s+([^\d,;]+)/gi)].map((match) => ({
    code: match[1],
    place: placeKey(match[2]),
  }))
  return pairs.reverse()
}

function samePlace(typed: string, listed: string): boolean {
  return typed === listed || typed.startsWith(`${listed} `) || listed.startsWith(`${typed} `)
}

export interface PostalPlace {
  federalState: string
  code: string
  place: string
}

export function namesAnotherCountry(address: string): boolean {
  return FOREIGN.test(address)
}

export function postalPlaceOf(address: string): PostalPlace | null {
  if (namesAnotherCountry(address)) return null
  for (const { code, place } of postalPairs(address)) {
    const places = postalTable().get(code)
    if (!places || !place) continue
    const states = new Set([...places].filter(([listed]) => samePlace(place, listed)).map(([, state]) => state))
    if (states.size === 1) return { federalState: [...states][0], code, place }
  }
  return null
}
