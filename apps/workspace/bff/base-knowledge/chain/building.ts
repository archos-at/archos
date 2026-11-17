import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { buildingIdsOf } from '@/lib/project-intake/derivation-view'
import { buildingClassInputsFor } from '@/lib/project-intake/needs'
import type { StoredRuleset } from '../rulesets/select'
import { factDefinitionsOf, setupScopeOf } from '@/lib/project-intake/setup-scope'
import type { BuildingInputs, BuildingScope } from '../rulesets/applicability'
import type { FactDefinition } from '../wire/setup-facts'

const NO_BUILDINGS: BuildingScope = { buildings: [], definitions: [] }

export function projectBuildings(
  profile: ProjectProfile | null | undefined,
  on: string,
  records: readonly StoredRuleset[]
): BuildingScope {
  if (!profile) return NO_BUILDINGS
  const definitions: readonly FactDefinition[] = factDefinitionsOf(setupScopeOf(profile, { on, records }))?.facts ?? []
  if (definitions.length === 0) return NO_BUILDINGS
  const keys = definitions.map((definition) => definition.key)
  const buildings: BuildingInputs[] = buildingIdsOf(profile, projectIntakeDefinitionV1).map((buildingId) => {
    const read = buildingClassInputsFor(profile, projectIntakeDefinitionV1, buildingId, keys)
    return { buildingId, inputs: Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined)) }
  })
  return { buildings, definitions: [...definitions] }
}
