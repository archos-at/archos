/**
 * The Bundesland a typed Austrian address names, read from its Postleitzahl
 * and the place after it, with nothing sent anywhere.
 *
 * Address search is off unless a deployment names a geocoder (ADR-0159), and
 * a typed address alone places no project (ADR-0158). An Austrian office's
 * every new project would then start without a Land, and without the OIB
 * verdicts that hang on it. A PLZ is public, deterministic data: this module
 * reads it from a table shipped with the code (`austrian-postal-codes.json`,
 * written by `scripts/generate_austrian_postal_codes.py` from GeoNames' postal
 * codes, https://www.geonames.org, CC BY 4.0).
 *
 * The code alone is not enough: Switzerland and Liechtenstein use four digits
 * too, so "8001 Zürich" would read as Styria. The place after the code must be
 * one the table lists for it, and a code that serves two Länder answers only
 * through a place that sits in one. Whatever this returns is a suggestion
 * (`intake-seed.ts` stores it as an unconfirmed assumption the person
 * confirms), never a fact. Pure.
 */

import lines from './austrian-postal-codes.json'

/** Code → place key → federal_state token. Built once, on first use. */
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

/** The form a place name is compared in; the generator's `place_key`, line for line. */
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

/** A country other than Austria named in the line: such an address is never read as Austrian. */
const FOREIGN = /\b(?:schweiz|switzerland|suisse|svizzera|liechtenstein|deutschland|germany|italien|italia|italy|slowenien|slovenia|ungarn|hungary|tschechien|czechia|slowakei|slovakia)\b|(?:^|[\s,])(?:CH|FL|D|DE|I|IT|SLO|SI|H|HU|CZ|SK)-\d/i

/** Every "PLZ Ort" pair in the line, the last first: the postal part of an address closes it. */
function postalPairs(address: string): Array<{ code: string; place: string }> {
  const pairs = [...address.matchAll(/(?:^|[\s,])(?:A-|AT-)?(\d{4})\s+([^\d,;]+)/gi)].map((match) => ({
    code: match[1],
    place: placeKey(match[2]),
  }))
  return pairs.reverse()
}

/** Whether a typed place is the listed one: the same words, or one of them the other followed by more. */
function samePlace(typed: string, listed: string): boolean {
  return typed === listed || typed.startsWith(`${listed} `) || listed.startsWith(`${typed} `)
}

export interface PostalPlace {
  /** The A2_land token. */
  federalState: string
  code: string
  /** The place as typed, normalised. */
  place: string
}

/** The Land a typed address names, or null when it names none this table can tell. */
export function postalPlaceOf(address: string): PostalPlace | null {
  if (FOREIGN.test(address)) return null
  for (const { code, place } of postalPairs(address)) {
    const places = postalTable().get(code)
    if (!places || !place) continue
    const states = new Set([...places].filter(([listed]) => samePlace(place, listed)).map(([, state]) => state))
    if (states.size === 1) return { federalState: [...states][0], code, place }
  }
  return null
}
