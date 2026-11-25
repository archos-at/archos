import {
  BUILDING_ID_IN_KEY,
  BUILDING_ID_PREFIX,
  buildingNumber,
  type BuildingInstance,
} from '@/lib/project-profile/intake-building-keys'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { confirmedFact } from './profile-edits'
import { MAX_INTAKE_BUILDINGS, type BuildingOperation, type DismissedValue } from './types'

export const BUILDING_REFUSALS = {
  unknownBuilding: 'unknown-building',
  lastBuilding: 'last-building',
  tooManyBuildings: 'too-many-buildings',
} as const
export type BuildingRefusal = (typeof BUILDING_REFUSALS)[keyof typeof BUILDING_REFUSALS]

export const buildingNameKey = (buildingId: string): string => `building_name@${buildingId}`

export function buildingsOf(profile: ProjectProfile, definition: ProjectIntakeDefinition): BuildingInstance[] {
  return answersFromProfile(profile, definition).buildings
}

export interface BuildingContext {
  userId: string
  now: string
  dismissed: readonly DismissedValue[]
}

export type BuildingPlan =
  | { ok: true; profile: ProjectProfile; buildingId: string; changedKeys: string[] }
  | { ok: false; refusal: BuildingRefusal }

const buildingIdOf = (key: string): string | null => BUILDING_ID_IN_KEY.exec(key)?.[1] ?? null

function nextBuildingId(buildings: readonly BuildingInstance[], dismissed: readonly DismissedValue[]): string {
  const taken = [
    ...buildings.map((building) => building.id),
    ...dismissed.flatMap((entry) => buildingIdOf(entry.key) ?? []),
  ].map(buildingNumber)
  return `${BUILDING_ID_PREFIX}${Math.max(0, ...taken) + 1}`
}

function freeName(buildings: readonly BuildingInstance[]): string {
  const taken = new Set(buildings.map((building) => building.name))
  for (let number = buildings.length + 1; ; number += 1) {
    const name = `Bauwerk ${number}`
    if (!taken.has(name)) return name
  }
}

function withName(profile: ProjectProfile, buildingId: string, name: string, context: BuildingContext): ProjectProfile {
  const fact = confirmedFact(name, [{ kind: 'person', userId: context.userId, at: context.now }], context.now)
  return { ...profile, facts: { ...profile.facts, [buildingNameKey(buildingId)]: fact } }
}

function withNamesKept(
  profile: ProjectProfile,
  buildings: readonly BuildingInstance[],
  now: string
): { profile: ProjectProfile; keys: string[] } {
  const unnamed = buildings.filter((building) => !(buildingNameKey(building.id) in profile.facts))
  const facts = { ...profile.facts }
  for (const building of unnamed) facts[buildingNameKey(building.id)] = confirmedFact(building.name, [], now)
  return { profile: { ...profile, facts }, keys: unnamed.map((building) => buildingNameKey(building.id)) }
}

function add(
  profile: ProjectProfile,
  buildings: readonly BuildingInstance[],
  name: string | undefined,
  context: BuildingContext
): BuildingPlan {
  if (buildings.length >= MAX_INTAKE_BUILDINGS) return { ok: false, refusal: BUILDING_REFUSALS.tooManyBuildings }
  const kept = withNamesKept(profile, buildings, context.now)
  const buildingId = nextBuildingId(buildings, context.dismissed)
  return {
    ok: true,
    profile: withName(kept.profile, buildingId, name ?? freeName(buildings), context),
    buildingId,
    changedKeys: [...kept.keys, buildingNameKey(buildingId)],
  }
}

function withoutBuilding(profile: ProjectProfile, buildingId: string): { profile: ProjectProfile; keys: string[] } {
  const stays = (key: string) => buildingIdOf(key) !== buildingId
  const keys = [...Object.keys(profile.facts), ...Object.keys(profile.assumptions)].filter((key) => !stays(key))
  return {
    profile: {
      ...profile,
      facts: Object.fromEntries(Object.entries(profile.facts).filter(([key]) => stays(key))),
      assumptions: Object.fromEntries(Object.entries(profile.assumptions).filter(([key]) => stays(key))),
      unknowns: profile.unknowns.filter(stays),
    },
    keys: [...new Set(keys)],
  }
}

export function planBuildingOperation(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  operation: BuildingOperation,
  context: BuildingContext
): BuildingPlan {
  const buildings = buildingsOf(profile, definition)
  if (operation.action === 'add') return add(profile, buildings, operation.name, context)
  const { buildingId } = operation
  if (!buildings.some((building) => building.id === buildingId)) {
    return { ok: false, refusal: BUILDING_REFUSALS.unknownBuilding }
  }
  if (operation.action === 'rename') {
    const next = withName(profile, buildingId, operation.name, context)
    return { ok: true, profile: next, buildingId, changedKeys: [buildingNameKey(buildingId)] }
  }
  if (buildings.length <= 1) return { ok: false, refusal: BUILDING_REFUSALS.lastBuilding }
  const removed = withoutBuilding(profile, buildingId)
  return { ok: true, profile: removed.profile, buildingId, changedKeys: removed.keys }
}
