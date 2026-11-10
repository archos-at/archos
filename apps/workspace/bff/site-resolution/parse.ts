/**
 * A typed address line as the parts a register is searched by (ADR-0172).
 * Pure and client-safe.
 *
 * Reads "Straße Nr, PLZ Ort", "Straße Nr PLZ Ort", "PLZ Ort, Straße Nr", an
 * optional country prefix (`A-`, `D-`, `CH-`) and a trailing country name. A
 * stated country is kept as stated: invariant A1, no axis inferred from
 * another. A five-digit postcode states nothing by itself: a Kleinwalsertal
 * address is typed with its German postcode and is Austrian (design E30).
 */

/** Country prefixes and names a person types, as ISO 3166-1 alpha-2. */
const COUNTRY_WORDS: Readonly<Record<string, string>> = {
  a: 'AT', at: 'AT', aut: 'AT', austria: 'AT', oesterreich: 'AT', 'österreich': 'AT', osterreich: 'AT',
  d: 'DE', de: 'DE', deu: 'DE', germany: 'DE', deutschland: 'DE',
  ch: 'CH', che: 'CH', schweiz: 'CH', switzerland: 'CH', suisse: 'CH', svizzera: 'CH',
  fl: 'LI', li: 'LI', liechtenstein: 'LI',
  i: 'IT', it: 'IT', italien: 'IT', italy: 'IT', italia: 'IT',
}

export interface ParsedAddress {
  /** The street (or farm or place name) before the house number. */
  street: string
  /** The house number as typed, without a door or staircase (`16` of `16/2/5` is kept in `doorless`). */
  houseNumber: string
  /** The number before a `/`, for a line that adds staircase and door; null when there is none. */
  doorless: string | null
  postcode: string | null
  place: string | null
  /** The country the line states, ISO alpha-2, or null when it states none. */
  statedCountry: string | null
}

function countryOf(word: string): string | null {
  return COUNTRY_WORDS[word.trim().toLowerCase().replace(/\.$/, '')] ?? null
}

/** "Herrengasse 16" → street and number; null without a number at its end. */
function streetAndNumber(segment: string): StreetPart | null {
  const match = /^(.*?\p{L}.*?)\s+(\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)*)$/iu.exec(segment.trim())
  if (!match) return null
  return { street: match[1].trim().replace(/[,.]$/, ''), houseNumber: match[2].replace(/\s+/g, ' ').trim() }
}

/** "8010 Graz", "D-87567 Riezlern", "A-1010 Wien" → postcode, place and a stated country. */
interface PostalPart {
  postcode: string
  place: string | null
  country: string | null
}

interface StreetPart {
  street: string
  houseNumber: string
}

function postcodeAndPlace(segment: string): PostalPart | null {
  const match = /^(?:([a-z]{1,3})\s*-\s*)?(\d{4,5})(?:\s+(.+))?$/iu.exec(segment.trim())
  if (!match) return null
  const country = match[1] ? countryOf(match[1]) : null
  if (match[1] && !country) return null
  return { postcode: match[2], place: match[3]?.trim() || null, country }
}

/** Split a line written without commas at its postcode: "Herrengasse 16 8010 Graz". */
function segmentsOf(line: string): string[] {
  const segments = line.split(',').map((part) => part.trim()).filter(Boolean)
  if (segments.length !== 1) return segments
  const match = /^(.*?\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)*)\s+((?:[a-z]{1,3}\s*-\s*)?\d{4,5}(?:\s+.+)?)$/iu.exec(segments[0])
  return match ? [match[1], match[2]] : segments
}

/** The parts of a typed line, or null when it names no street and house number: nothing to look up. */
export function parseAddress(line: string): ParsedAddress | null {
  const segments = segmentsOf(line.replace(/\s+/g, ' ').trim())
  let statedCountry: string | null = null
  let street: StreetPart | null = null
  let postal: PostalPart | null = null
  const loose: string[] = []
  for (const segment of segments) {
    const country = countryOf(segment)
    if (country) {
      statedCountry = country
      continue
    }
    const postcode: PostalPart | null = postal ? null : postcodeAndPlace(segment)
    if (postcode) {
      postal = postcode
      statedCountry = postcode.country ?? statedCountry
      continue
    }
    const named: StreetPart | null = street ? null : streetAndNumber(segment)
    if (named) street = named
    else loose.push(segment)
  }
  if (!street) return null
  const slash = street.houseNumber.indexOf('/')
  return {
    street: street.street,
    houseNumber: street.houseNumber,
    doorless: slash > 0 ? street.houseNumber.slice(0, slash).trim() : null,
    postcode: postal?.postcode ?? null,
    place: postal?.place ?? loose[0] ?? null,
    statedCountry,
  }
}
