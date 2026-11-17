import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { compileRecordPattern, type AddressRegisterRecord } from '@/lib/base-knowledge/wire/setup-facts'
import { addressRegistersOf, subdivisionLabels, subdivisionTerritories } from '@/lib/project-intake/setup-scope'

export interface AddressRegister {
  id: string
  country: string
  publisher: string
  municipalityTerritory: (code: string) => string
  postcodeShape: RegExp
  crossBorderPostcodes: RegExp | null
  stateOf: (code: string) => string | null
  downloadUrl: (referenceDate: string) => string
}

function compiled(pattern: string): RegExp {
  const regex = compileRecordPattern(pattern)
  if (!regex) throw new Error(`The register pattern ${pattern} is not a safe, anchored pattern.`)
  return regex
}

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

export interface SiteReference {
  registers: Readonly<Record<string, AddressRegister>>
  stateNames: Readonly<Record<string, string>>
  federalStateToken: (stateTerritory: string) => string | null
}

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

export function registerFor(reference: SiteReference, country: string): AddressRegister | null {
  return Object.values(reference.registers).find((register) => register.country === country) ?? null
}
