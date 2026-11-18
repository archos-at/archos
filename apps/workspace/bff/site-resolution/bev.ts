import { houseKey, placeKey, streetKey } from './normalize'

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

export function bevLookups(tables: {
  municipalityRows: Iterable<Record<string, string>>
  localityRows: Iterable<Record<string, string>>
  streetRows: Iterable<Record<string, string>>
}): BevLookups {
  const municipalities = new Map<string, string>()
  for (const row of tables.municipalityRows) municipalities.set(row.GKZ, row['GEMEINDENAME'])
  const localities = new Map<string, string>()
  for (const row of tables.localityRows) localities.set(`${row.GKZ}:${row.OKZ}`, row['ORTSNAME'])
  const streets = new Map<string, { name: string; deliveryPlace: string }>()
  for (const row of tables.streetRows) {
    const name = [row['STRASSENNAME'], row['STRASSENNAMENZUSATZ']].filter(Boolean).join(' ')
    streets.set(row.SKZ, { name, deliveryPlace: row['ZUSTELLORT'] })
  }
  return { municipalities, localities, streets }
}

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

export function bevEntry(row: Record<string, string>, lookups: BevLookups): RegisterEntry | null {
  const municipalityName = lookups.municipalities.get(row.GKZ)
  const houseNumber = row['HNR_ADR_ZUSAMMEN']?.trim()
  if (!municipalityName || !row.PLZ || !houseNumber || !row.ADRCD) return null
  const localityName = lookups.localities.get(`${row.GKZ}:${row.OKZ}`) ?? null
  const street = row.SKZ ? lookups.streets.get(row.SKZ) : undefined
  const streetName = street?.name || row['HOFNAME']?.trim() || localityName
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

export function bevAttribution(referenceDate: string): string {
  const [year, month, day] = referenceDate.split('-')
  return `© Österreichisches Adressregister, Stichtagsdaten vom ${day}.${month}.${year}`
}
