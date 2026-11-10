/**
 * What narrows a site's chain by the project's buildings (ADR-0176): the
 * buildings as the country's fact definitions read them off the profile, and
 * the applicability tables in force on the chain. The resolver stays pure;
 * this is where the two are read.
 *
 * A read that cannot be trusted narrows nothing: a truncated read or a table
 * the evaluator cannot parse leaves every work named, as before narrowing,
 * and says so in the log. Too much law is a nuisance a person sees; too little
 * is the silent fault the build replaced.
 */

import 'server-only'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { buildingIdsOf } from '@/lib/project-intake/derivation-view'
import { buildingClassInputsFor } from '@/lib/project-intake/needs'
import { factDefinitionsOf, setupScopeOf } from '@/lib/project-intake/setup-scope'
import type { BuildingInputs } from '../rulesets/applicability'
import { readRulesetsInForce } from '../store/rulesets'
import type { FactDefinition } from '../wire/setup-facts'
import type { BuildingScope } from './resolve'

export interface ProjectBuildings {
  buildings: BuildingInputs[]
  definitions: FactDefinition[]
}

const NO_BUILDINGS: ProjectBuildings = { buildings: [], definitions: [] }

/** The project's buildings, each with the answers to the facts its country defines, read on `on`. Pure. */
export function projectBuildings(profile: ProjectProfile | null | undefined, on: string): ProjectBuildings {
  if (!profile) return NO_BUILDINGS
  const definitions = factDefinitionsOf(setupScopeOf(profile, { on }))?.facts ?? []
  if (definitions.length === 0) return NO_BUILDINGS
  const keys = definitions.map((definition) => definition.key)
  const buildings = buildingIdsOf(profile, projectIntakeDefinitionV1).map((buildingId) => {
    const read = buildingClassInputsFor(profile, projectIntakeDefinitionV1, buildingId, keys)
    const inputs = Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined))
    return { buildingId, inputs }
  })
  return { buildings, definitions: [...definitions] }
}

/** The building scope for a chain: its applicability tables, or null when the read cannot be trusted. */
export async function buildingScopeFor(
  organizationId: string,
  chain: readonly string[],
  project: ProjectBuildings,
): Promise<BuildingScope | null> {
  const read = await readRulesetsInForce(organizationId, { purpose: 'applicability', territoryIds: chain })
  if (read.truncated || read.unreadable.length > 0) {
    console.error('[applicability] the applicability tables could not be read whole; the chain is not narrowed', {
      organizationId,
      truncated: read.truncated,
      unreadable: read.unreadable,
    })
    return null
  }
  return { rulesets: read.rulesets, buildings: project.buildings, definitions: project.definitions }
}
