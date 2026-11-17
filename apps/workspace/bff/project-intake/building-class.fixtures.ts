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
  ['an EFH, freistehend and reachable from three sides, is GK 1', singleFamilyHouse, known(1)],
  [
    'the same EFH without three-side access is GK 2',
    { ...singleFamilyHouse, access_three_sides: 'no' },
    known(2),
  ],
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
  ['an MFH of 3 oG, FN 6.5 m, 900 m², six units, is GK 3', multiFamilyHouse, known(3)],
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
  [
    'six storeys at FN 18 m is GK 5, and nothing else matters',
    building({ storeys_above_ground: 6, escape_level_m: 18 }),
    known(5),
  ],
  [
    'FN 25 m is a Hochhaus',
    building({ escape_level_m: 25 }),
    { value: null, hochhaus: true, applicable: true, missing: [] },
  ],
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
