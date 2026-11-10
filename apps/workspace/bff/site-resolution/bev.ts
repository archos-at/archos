/**
 * The BEV Adressregister's relational tables ("Adresse Relationale Tabellen –
 * Stichtagsdaten", CSV, `;`-separated, quoted, UTF-8 with a BOM) as register
 * entries (ADR-0172). Pure: the importer (`scripts/import-address-register.ts`)
 * reads the files and writes what this returns.
 *
 * Four of the archive's tables are read: GEMEINDE (GKZ → name), ORTSCHAFT
 * (GKZ + OKZ → locality), STRASSE (SKZ → street, delivery place) and ADRESSE
 * (one row per address). An address with no street (a farm, a hamlet with
 * house numbers only) is keyed by its farm name, else its locality, which is
 * how such an address is written. Format: the archive's own
 * `BEV_S_AD_Adresse_Relationale_Tabellen-Stichtagsdaten-CSV_V1.5.pdf`.
 */

import { houseKey, placeKey, streetKey } from './normalize'

/** One `;`-separated line with `"`-quoted fields; a doubled quote is a quote. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"'
        index++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ';') {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields
}

/** A table's rows as objects keyed by its header, BOM and blank lines dropped. */
export function* csvRecords(lines: Iterable<string>): Generator<Record<string, string>> {
  let header: string[] | null = null
  for (const raw of lines) {
    const line = raw.replace(/^\uFEFF/, '').replace(/\r$/, '')
    if (!line.trim()) continue
    const fields = splitCsvLine(line)
    if (!header) {
      header = fields
      continue
    }
    yield Object.fromEntries(header.map((name, index) => [name, fields[index] ?? '']))
  }
}

export interface BevLookups {
  municipalities: Map<string, string>
  localities: Map<string, string>
  streets: Map<string, { name: string; deliveryPlace: string }>
}

/** The three small tables as maps, for {@link bevEntry}. */
export function bevLookups(tables: {
  gemeinde: Iterable<Record<string, string>>
  ortschaft: Iterable<Record<string, string>>
  strasse: Iterable<Record<string, string>>
}): BevLookups {
  const municipalities = new Map<string, string>()
  for (const row of tables.gemeinde) municipalities.set(row.GKZ, row.GEMEINDENAME)
  const localities = new Map<string, string>()
  for (const row of tables.ortschaft) localities.set(`${row.GKZ}:${row.OKZ}`, row.ORTSNAME)
  const streets = new Map<string, { name: string; deliveryPlace: string }>()
  for (const row of tables.strasse) {
    const name = [row.STRASSENNAME, row.STRASSENNAMENZUSATZ].filter(Boolean).join(' ')
    streets.set(row.SKZ, { name, deliveryPlace: row.ZUSTELLORT })
  }
  return { municipalities, localities, streets }
}

/** One row of `address_register_entries`, without its release. */
export interface RegisterEntry {
  addressId: string
  municipalityCode: string
  municipalityName: string
  localityName: string | null
  postcode: string
  streetName: string
  houseNumber: string
  streetKey: string
  houseKey: string
  placeKeys: string[]
  easting: number | null
  northing: number | null
  crs: number | null
}

function coordinate(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * An ADRESSE row as an entry, or null when it cannot be keyed: no municipality
 * the GEMEINDE table names, no postcode, or no house number. Skipped rows are
 * counted by the importer, never guessed at.
 */
export function bevEntry(row: Record<string, string>, lookups: BevLookups): RegisterEntry | null {
  const municipalityName = lookups.municipalities.get(row.GKZ)
  const houseNumber = row.HNR_ADR_ZUSAMMEN?.trim()
  if (!municipalityName || !row.PLZ || !houseNumber || !row.ADRCD) return null
  const localityName = lookups.localities.get(`${row.GKZ}:${row.OKZ}`) ?? null
  const street = row.SKZ ? lookups.streets.get(row.SKZ) : undefined
  const streetName = street?.name || row.HOFNAME?.trim() || localityName
  if (!streetName) return null
  const places = [municipalityName, localityName, street?.deliveryPlace].filter((place): place is string => Boolean(place))
  return {
    addressId: row.ADRCD,
    municipalityCode: row.GKZ,
    municipalityName,
    localityName,
    postcode: row.PLZ,
    streetName,
    houseNumber,
    streetKey: streetKey(streetName),
    houseKey: houseKey(houseNumber),
    placeKeys: [...new Set(places.map(placeKey))],
    easting: coordinate(row.RW),
    northing: coordinate(row.HW),
    crs: coordinate(row.EPSG),
  }
}

/** What the licence asks every use to say (the archive's `Licensing_Conditions.txt`). */
export function bevAttribution(referenceDate: string): string {
  const [year, month, day] = referenceDate.split('-')
  return `© Österreichisches Adressregister, Stichtagsdaten vom ${day}.${month}.${year}`
}
