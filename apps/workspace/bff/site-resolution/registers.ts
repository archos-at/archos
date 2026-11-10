/**
 * The address registers this cell hosts, and how a register row places a site
 * in the territory tree (ADR-0172). Pure and client-safe.
 *
 * A register is a country's official address list, imported into the cell's
 * own database (`address_register_entries`); a lookup never leaves the cell.
 * Austria's is the BEV Adressregister. Germany's (design E31) is a second
 * entry here and an importer beside `bev.ts`: the resolver, the routes and the
 * tables take it unchanged.
 */

import { FEDERAL_STATE_TERRITORIES } from '@/lib/base-knowledge/office/reading'

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
  crossBorderPostcodes: RegExp
  /** The state (Land) a municipality lies in, from its code alone; null when the code names none. */
  stateOf: (code: string) => string | null
  /** The bulk file the importer reads: an official download, never a query. */
  downloadUrl: (referenceDate: string) => string
}

/** The first digit of a Gemeindekennziffer is its Land, numbered as ISO 3166-2:AT numbers them. */
function austrianStateOf(code: string): string | null {
  return /^[1-9]\d{4}$/.test(code) ? `AT-${code[0]}` : null
}

export const BEV_ADDRESS_REGISTER: AddressRegister = {
  id: 'at-bev',
  country: 'AT',
  publisher: 'BEV – Bundesamt für Eich- und Vermessungswesen (Österreichisches Adressregister)',
  municipalityTerritory: (code) => `AT:gkz:${code}`,
  postcodeShape: /^\d{4}$/,
  // Mittelberg (Kleinwalsertal) 87567–87569, Jungholz 87491.
  crossBorderPostcodes: /^(8756[7-9]|87491)$/,
  stateOf: austrianStateOf,
  // The relational tables as of a reference date ("Stichtagsdaten"), published twice a year (CC BY 4.0).
  downloadUrl: (referenceDate) =>
    `https://data.bev.gv.at/download/Adressregister/Archiv_Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_${referenceDate.replace(/-/g, '')}.zip`,
}

/** Every register a cell can host, by id. */
export const ADDRESS_REGISTERS: Readonly<Record<string, AddressRegister>> = {
  [BEV_ADDRESS_REGISTER.id]: BEV_ADDRESS_REGISTER,
}

/** The register for a country, or null when no register is defined for it (Germany until E31). */
export function registerFor(country: string): AddressRegister | null {
  return Object.values(ADDRESS_REGISTERS).find((register) => register.country === country) ?? null
}

/** A site's chain, leaf first, as the rulesets evaluator selects by it: municipality, state, country. */
export function territoryChain(register: AddressRegister, municipalityCode: string): string[] {
  const state = register.stateOf(municipalityCode)
  return [register.municipalityTerritory(municipalityCode), ...(state ? [state] : []), register.country]
}

const FEDERAL_STATE_TOKEN_BY_TERRITORY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FEDERAL_STATE_TERRITORIES).map(([token, territory]) => [territory, token])
)

/** The intake's `federal_state` token of an Austrian Land (`AT-6` → `styria`), or null. */
export function federalStateToken(stateTerritory: string): string | null {
  return FEDERAL_STATE_TOKEN_BY_TERRITORY[stateTerritory] ?? null
}

/** The Länder as a person reads them, by ISO 3166-2 code. */
export const STATE_NAMES: Readonly<Record<string, string>> = {
  'AT-1': 'Burgenland',
  'AT-2': 'Kärnten',
  'AT-3': 'Niederösterreich',
  'AT-4': 'Oberösterreich',
  'AT-5': 'Salzburg',
  'AT-6': 'Steiermark',
  'AT-7': 'Tirol',
  'AT-8': 'Vorarlberg',
  'AT-9': 'Wien',
}
