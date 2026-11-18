const COUNTRY_WORDS: Readonly<Record<string, string>> = {
  a: 'AT', at: 'AT', aut: 'AT', austria: 'AT', oesterreich: 'AT', 'österreich': 'AT', osterreich: 'AT',
  d: 'DE', de: 'DE', deu: 'DE', germany: 'DE', deutschland: 'DE',
  ch: 'CH', che: 'CH', schweiz: 'CH', switzerland: 'CH', suisse: 'CH', svizzera: 'CH',
  fl: 'LI', li: 'LI', liechtenstein: 'LI',
  i: 'IT', it: 'IT', italien: 'IT', italy: 'IT', italia: 'IT',
}

export interface ParsedAddress {
  street: string
  houseNumber: string
  doorless: string | null
  postcode: string | null
  place: string | null
  statedCountry: string | null
}

function countryOf(word: string): string | null {
  return COUNTRY_WORDS[word.trim().toLowerCase().replace(/\.$/, '')] ?? null
}

function streetAndNumber(segment: string): StreetPart | null {
  const lot = /^(.*?\p{L}.*?)\s+(GNR\s*\.?\s*\d+(?:\s*\/\s*\d+)?)$/iu.exec(segment.trim())
  if (lot) return { street: lot[1].trim(), houseNumber: lot[2].replace(/\s+/g, ' ').trim() }
  const match = /^(.*?\p{L}.*?)\s+(\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)*)$/iu.exec(segment.trim())
  if (!match) return null
  return { street: match[1].trim().replace(/[,.]$/, ''), houseNumber: match[2].replace(/\s+/g, ' ').trim() }
}

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

function segmentsOf(line: string): string[] {
  const segments = line.split(',').map((part) => part.trim()).filter(Boolean)
  if (segments.length !== 1) return segments
  const match = /^(.*?\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)*)\s+((?:[a-z]{1,3}\s*-\s*)?\d{4,5}(?:\s+.+)?)$/iu.exec(segments[0])
  return match ? [match[1], match[2]] : segments
}

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
  const slash = /^GNR/i.test(street.houseNumber) ? -1 : street.houseNumber.indexOf('/')
  return {
    street: street.street,
    houseNumber: street.houseNumber,
    doorless: slash > 0 ? street.houseNumber.slice(0, slash).trim() : null,
    postcode: postal?.postcode ?? null,
    place: postal?.place ?? loose[0] ?? null,
    statedCountry,
  }
}
