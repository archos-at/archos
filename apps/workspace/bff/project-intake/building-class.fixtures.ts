/**
 * The Gebäudeklasse cases the derivation is held to (`derivations.spec.ts`), shared
 * so the ruleset that expresses the same rules as data
 * (`base-knowledge/rulesets/building-class.spec.ts`) is held to exactly the same
 * cases. One list, two implementations: a case added here tests both.
 */
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { BUILDING_CLASS_INPUTS, type BuildingClassResult } from './derivations.oracle'

export type Inputs = Record<string, ProjectPrimitiveValue | undefined>

export const building = (inputs: Inputs): Inputs => ({ building_type: 'building', ...inputs })

export const singleFamilyHouse: Inputs = building({
  building_position: 'freestanding',
  access_three_sides: true,
  storeys_above_ground: 2,
  escape_level_m: 3.2,
  gfa_above_ground: 180,
  use_units: 1,
  uses: ['residential'],
})

export const multiFamilyHouse: Inputs = building({
  building_position: 'freestanding',
  access_three_sides: true,
  storeys_above_ground: 3,
  escape_level_m: 6.5,
  gfa_above_ground: 900,
  use_units: 6,
  units_over_400: false,
  uses: ['residential'],
})

export const known = (value: BuildingClassResult['value']) => ({
  value,
  hochhaus: false,
  applicable: true,
  missing: [],
})

export const BUILDING_CLASS_CASES: [string, Inputs, BuildingClassResult][] = [
  // Every GK 1 condition holds; the units >400 and the uses do not matter once it is GK 1.
  ['an EFH, freistehend and reachable from three sides, is GK 1', singleFamilyHouse, known(1)],
  // No longer GK 1 (no three-side access), but 180 m² ≤ 400 m² makes it GK 2 by the first branch.
  [
    'the same EFH without three-side access is GK 2',
    { ...singleFamilyHouse, access_three_sides: 'no' },
    known(2),
  ],
  // Angebaut excludes GK 1; 300 m² ≤ 400 m² gives GK 2.
  [
    'a Doppelhaus half, angebaut, 2 oG, 300 m², is GK 2',
    building({
      building_position: 'attached',
      storeys_above_ground: 2,
      escape_level_m: 6,
      gfa_above_ground: 300,
      use_units: 1,
    }),
    known(2),
  ],
  // 900 m² is past both area branches; the Reihenhaus branch holds because no unit exceeds 400 m².
  [
    'a Reihenhaus of three units of at most 400 m², 900 m² in all, is GK 2',
    building({
      building_position: 'terraced',
      storeys_above_ground: 2,
      escape_level_m: 6,
      gfa_above_ground: 900,
      use_units: 3,
      units_over_400: false,
    }),
    known(2),
  ],
  // Low (3 oG, 6.5 m) but 900 m² > 800 m² for the residential branch, and not a Reihenhaus: GK 3.
  ['an MFH of 3 oG, FN 6.5 m, 900 m², six units, is GK 3', multiFamilyHouse, known(3)],
  // 4 oG is past GK 1–3; FN 10 ≤ 11 and no unit above 400 m²: GK 4 a).
  [
    'four storeys, FN 10 m, 1600 m², twelve units none above 400 m², is GK 4',
    {
      ...multiFamilyHouse,
      storeys_above_ground: 4,
      escape_level_m: 10,
      gfa_above_ground: 1600,
      use_units: 12,
    },
    known(4),
  ],
  // Several units and one above 400 m²: neither GK 4 a) nor b), so GK 5.
  [
    'four storeys, FN 10 m, one of three units above 400 m², is GK 5',
    {
      ...multiFamilyHouse,
      storeys_above_ground: 4,
      escape_level_m: 10,
      gfa_above_ground: 1600,
      use_units: 3,
      units_over_400: true,
    },
    known(5),
  ],
  // 6 oG rules out GK 1–4 whatever else holds, and FN 18 ≤ 22: GK 5 with nothing else known.
  [
    'six storeys at FN 18 m is GK 5, and nothing else matters',
    building({ storeys_above_ground: 6, escape_level_m: 18 }),
    known(5),
  ],
  // Above 22 m there is no class at all.
  [
    'FN 25 m is a Hochhaus',
    building({ escape_level_m: 25 }),
    { value: null, hochhaus: true, applicable: true, missing: [] },
  ],
  // One Betriebseinheit of 2000 m²: GK 4 b) has no area limit.
  [
    'an office of one unit, 4 oG, FN 10.5 m, 2000 m², is GK 4',
    building({
      building_position: 'freestanding',
      access_three_sides: true,
      storeys_above_ground: 4,
      escape_level_m: 10.5,
      gfa_above_ground: 2000,
      use_units: 1,
      uses: ['office'],
    }),
    known(4),
  ],
  // FN ≤ 7 gives GK 2; FN in (7, 11] gives GK 4 or GK 5 depending on the units; above 22 m a Hochhaus.
  [
    'without the Fluchtniveau, an angebaut 2-storey 300 m² building is open, and the units matter too',
    building({ building_position: 'attached', storeys_above_ground: 2, gfa_above_ground: 300 }),
    {
      value: null,
      hochhaus: false,
      applicable: true,
      missing: ['escape_level_m', 'use_units', 'units_over_400'],
    },
  ],
  // With the units known not to exceed 400 m², only the Fluchtniveau is left to decide.
  [
    'and with the units known, only the Fluchtniveau is missing',
    building({
      building_position: 'attached',
      storeys_above_ground: 2,
      gfa_above_ground: 300,
      use_units: 2,
      units_over_400: false,
    }),
    { value: null, hochhaus: false, applicable: true, missing: ['escape_level_m'] },
  ],
  [
    'a Kleinstgebäude is not classified',
    { building_type: 'small', escape_level_m: 3 },
    { value: null, hochhaus: false, applicable: false, missing: [] },
  ],
  [
    'nothing known: the Bauwerkstyp is the first thing that matters',
    {},
    { value: null, hochhaus: false, applicable: true, missing: [...BUILDING_CLASS_INPUTS] },
  ],
]
