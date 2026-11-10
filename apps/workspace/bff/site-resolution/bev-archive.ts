/**
 * The BEV archive (a zip of the relational tables) as register entries
 * (ADR-0172). Read by the importer script and the register spike; no
 * `server-only`, it runs outside Next.
 */

import { unzipSync } from 'fflate'
import { bevEntry, bevLookups, csvRecords, type BevLookups, type RegisterEntry } from './bev'

const TABLES = ['GEMEINDE.csv', 'ORTSCHAFT.csv', 'STRASSE.csv', 'ADRESSE.csv', 'Aktualitaetsstand.txt'] as const

/** The lines of a UTF-8 file, decoded a megabyte at a time: ADRESSE.csv is a third of a gigabyte. */
export function* linesOf(bytes: Uint8Array): Generator<string> {
  const decoder = new TextDecoder('utf-8')
  let rest = ''
  for (let offset = 0; offset < bytes.length; offset += 1 << 20) {
    const chunk = rest + decoder.decode(bytes.subarray(offset, offset + (1 << 20)), { stream: true })
    const lines = chunk.split('\n')
    rest = lines.pop() ?? ''
    yield* lines
  }
  rest += decoder.decode()
  if (rest) yield rest
}

export interface BevArchive {
  /** The reference date the archive states (`Aktualitaetsstand.txt`), or null. */
  referenceDate: string | null
  lookups: BevLookups
  /** The addresses, keyed; `skipped` counts the rows that could not be. */
  entries: () => Generator<RegisterEntry>
  skipped: () => number
}

/** "Aktualitätsstand (Stichtag) der enthaltenen Daten: 01.10.2025" → 2025-10-01. Latin-1, as the BEV writes it. */
function referenceDateOf(file: Uint8Array | undefined): string | null {
  if (!file) return null
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(new TextDecoder('latin1').decode(file))
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

/** Read a BEV zip. Throws when a table is missing. */
export function readBevArchive(zip: Uint8Array): BevArchive {
  const files = unzipSync(zip, { filter: (file) => TABLES.some((name) => file.name.endsWith(name)) })
  const table = (name: string): Uint8Array => {
    const found = Object.entries(files).find(([path]) => path.endsWith(name))
    if (!found) throw new Error(`The archive has no ${name}.`)
    return found[1]
  }
  const lookups = bevLookups({
    municipalityRows: csvRecords(linesOf(table('GEMEINDE.csv'))),
    localityRows: csvRecords(linesOf(table('ORTSCHAFT.csv'))),
    streetRows: csvRecords(linesOf(table('STRASSE.csv'))),
  })
  let skipped = 0
  return {
    referenceDate: referenceDateOf(Object.entries(files).find(([path]) => path.endsWith('Aktualitaetsstand.txt'))?.[1]),
    lookups,
    *entries() {
      skipped = 0
      for (const row of csvRecords(linesOf(table('ADRESSE.csv')))) {
        const entry = bevEntry(row, lookups)
        if (entry) yield entry
        else skipped += 1
      }
    },
    skipped: () => skipped,
  }
}
