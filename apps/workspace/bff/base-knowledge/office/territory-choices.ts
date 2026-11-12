/**
 * Where an office's standard can apply, as choices for the form („Gilt in“):
 * the office's countries and the subdivisions its setup records name, each
 * with its label. A country is data (ADR-0162), so the list comes from the
 * records and the office's entitlements, never from a table in code.
 */

import 'server-only'
import { readSetupRecords } from '@/lib/project-intake/setup-records'
import { subdivisionLabels } from '@/lib/project-intake/setup-scope'
import { readOrganizationCountries } from '../platform/entitlements'

export async function territoryChoices(organizationId: string): Promise<{ id: string; label: string | null }[]> {
  const [countries, records] = await Promise.all([readOrganizationCountries(organizationId), readSetupRecords(organizationId)])
  const countryIds = [...new Set([countries.homeCountry, ...countries.entitled.map((entry) => entry.countryId)].filter((id): id is string => Boolean(id)))]
  const subdivisions = Object.entries(subdivisionLabels(records))
    .filter(([id]) => countryIds.length === 0 || countryIds.some((country) => id.startsWith(`${country}-`)))
    .sort(([, a], [, b]) => a.localeCompare(b, 'de'))
    .map(([id, label]) => ({ id, label }))
  return [...countryIds.map((id) => ({ id, label: null })), ...subdivisions]
}
