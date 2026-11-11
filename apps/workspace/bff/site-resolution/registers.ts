/**
 * The address registers a cell hosts, and how a register row places a site in
 * the territory tree (ADR-0172). Pure and client-safe.
 *
 * A register is a country's official address list, imported into the cell's
 * own database (`address_register_entries`); a lookup never leaves the cell.
 * What describes it (who publishes it, how its rows name a municipality and a
 * state, which postcodes it covers, where its bulk file is) is data of the
 * country: the `addressRegister` block of its released `fact_definitions`
 * record (`wire/setup-facts.ts`), read here into a {@link SiteReference}. A
 * second country's register is a record and an importer for its file format,
 * never an entry in this module; one whose record is not published is no
 * register, so its addresses stay `unverified` (`no_register`).
 */

import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { compileRecordPattern, type AddressRegisterRecord } from '@/lib/base-knowledge/wire/setup-facts'
import { addressRegistersOf, subdivisionLabels, subdivisionTerritories } from '@/lib/project-intake/setup-scope'

export interface AddressRegister {
  /** `<country>-<publisher>`, the `register` column of `address_register_releases`. */
  id: string
  /** ISO 3166-1 alpha-2. */
  country: string
  /** Who publishes it, for a person reading where an address was confirmed. */
  publisher: string
  /** The territory id of a municipality by its official code: `AT:gkz:60101` (ADR-0165's territory ids). */
  municipalityTerritory: (code: string) => string
  /** A postcode of this country's shape: a filter on the register's rows. */
  postcodeShape: RegExp
  /**
   * A neighbour's postcodes that this country's addresses are written with
   * (the Kleinwalsertal and Jungholz are delivered by the Deutsche Post, design
   * E30): not a filter, and not evidence of the neighbour. Any other postcode of
   * another shape is such evidence, and the register is not searched.
   */
  crossBorderPostcodes: RegExp | null
  /** The state (Land) a municipality lies in, from its code alone; null when the code names none. */
  stateOf: (code: string) => string | null
  /** The bulk file the importer reads: an official download, never a query. */
  downloadUrl: (referenceDate: string) => string
}

/** A pattern the record validation already accepted; a record that skipped it fails loudly rather than run unchecked. */
function compiled(pattern: string): RegExp {
  const regex = compileRecordPattern(pattern)
  if (!regex) throw new Error(`The register pattern ${pattern} is not a safe, anchored pattern.`)
  return regex
}

/** A register record as the functions the resolver and the importer call. */
export function registerFromRecord(country: string, record: AddressRegisterRecord): AddressRegister {
  const stateOfCode = record.stateFromCode
  const statePattern = stateOfCode ? compiled(stateOfCode.pattern) : null
  return {
    id: record.id,
    country,
    publisher: record.publisher,
    municipalityTerritory: (code) => record.municipalityTerritory.replace('{code}', code),
    postcodeShape: compiled(record.postcodePattern),
    crossBorderPostcodes: record.crossBorderPostcodePattern ? compiled(record.crossBorderPostcodePattern) : null,
    stateOf: (code) => {
      const match = statePattern?.exec(code)
      return match && stateOfCode ? stateOfCode.territory.replace('{1}', match[1] ?? '') : null
    },
    downloadUrl: (referenceDate) => record.downloadUrl.replace('{yyyymmdd}', referenceDate.replace(/-/g, '')),
  }
}

/** What the resolver reads of the released records: the registers, and the Länder as a person and the intake read them. */
export interface SiteReference {
  registers: Readonly<Record<string, AddressRegister>>
  /** The Länder as a person reads them, by ISO 3166-2 code. */
  stateNames: Readonly<Record<string, string>>
  /** The intake's `federal_state` token of a Land (`AT-6` is `styria`), or null. */
  federalStateToken: (stateTerritory: string) => string | null
}

/** The site reference of the setup records in force: empty without any (fail closed: no register, no Land). */
export function siteReferenceOf(records: readonly StoredRuleset[], on?: string): SiteReference {
  const registers = Object.fromEntries(
    addressRegistersOf(records, on).map(({ country, register }) => [register.id, registerFromRecord(country, register)])
  )
  const tokenByTerritory = new Map(Object.entries(subdivisionTerritories(records, on)).map(([token, territory]) => [territory, token]))
  return {
    registers,
    stateNames: subdivisionLabels(records, on),
    federalStateToken: (stateTerritory) => tokenByTerritory.get(stateTerritory) ?? null,
  }
}

/** The register for a country, or null when no published record describes one for it. */
export function registerFor(reference: SiteReference, country: string): AddressRegister | null {
  return Object.values(reference.registers).find((register) => register.country === country) ?? null
}
