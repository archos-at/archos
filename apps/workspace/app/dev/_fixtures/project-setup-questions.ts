/**
 * Step 4, Rückfragen, drawn from fixtures (`/dev/project-setup?step=questions&state=<name>`)
 * and in its specs. The location register is computed by the real register
 * from a profile, so a fixture cannot drift from the register's data: the
 * Aufstockung in Wien the other fixtures describe, a project whose address was
 * typed without a geocoder (no Bundesland yet), a reading still running, a
 * past project, and a round with everything settled.
 *
 * The registers are a snapshot (`project-setup-questions.registers.json`) of what the real register
 * computes from `REGISTER_INPUTS` and Austria's records: the build holds no country's records, and
 * `project-setup-questions.spec.ts` fails when the snapshot drifts (run it with UPDATE_SNAPSHOT=1).
 */

import { computeNeeds } from '@/lib/project-intake/needs'
import { locationRegisterFor, type LocationRegisterInput } from '@/lib/project-intake/location-register'
import type { IntakeMode, IntakeView, LocationRegisterView } from '@/lib/project-intake/types'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { FIXTURE_LOCATION, INTAKE_CLOSING, INTAKE_READING, INTAKE_READY, OPEN_PHASE } from './project-intake'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import registerSnapshot from './project-setup-questions.registers.json'

const AT = '2026-10-20T08:00:00.000Z'

function profileOf(
  facts: Record<string, ProjectPrimitiveValue>,
  suggestions: Record<string, ProjectPrimitiveValue> = {},
  unknowns: string[] = []
): ProjectProfile {
  const profile = emptyProjectProfile()
  for (const [key, value] of Object.entries(facts)) {
    profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: AT }
  }
  for (const [key, value] of Object.entries(suggestions)) {
    profile.assumptions[key] = { value, status: 'unconfirmed', reason: 'gelesen', source: 'agent_suggested', updatedAt: AT }
  }
  profile.unknowns.push(...unknowns)
  return profile
}

interface RegisterInput {
  profile: ProjectProfile
  location: LocationRegisterInput['location']
  mode?: IntakeMode
}

/** The real register for one input, from the records it is handed. */
export function registerOf({ profile, location, mode = 'active' }: RegisterInput, records: readonly StoredRuleset[]): LocationRegisterView {
  const needs = computeNeeds(profile, projectIntakeDefinitionV1, { mode, dismissed: [], records })
  return locationRegisterFor({ profile, location, mode, needs, records })
}

const snapshotOf = (name: keyof typeof REGISTER_INPUTS): LocationRegisterView => registerSnapshot[name] as LocationRegisterView

/** The Aufstockung in Wien: a Bestand with Wohnungen, Zubau and Umbau; the reading found the Widmung. */
const VIENNA_STOREY_ADDITION = {
  country: 'at',
  federal_state: 'vienna',
  work_type: ['extension', 'conversion'],
  'building_type@bldg1': 'building',
  'construction_status@bldg1': 'existing',
  'uses@bldg1': ['residential'],
}

/** What each fixture's register is computed from. */
export const REGISTER_INPUTS = {
  ready: { profile: profileOf(VIENNA_STOREY_ADDITION, { zoning: 'residential', development_plan: 'yes' }), location: FIXTURE_LOCATION },
  // Placed in Austria, the Land still open: a project nothing places gets no document until it is (ADR-0169).
  typedAddress: { profile: profileOf({ site_address: 'Hauptstraße 4, 3420 Kritzendorf', country: 'at' }), location: null },
  closing: { profile: profileOf({ work_type: ['new_build'] }), location: null, mode: 'closing' },
  done: {
    profile: profileOf(
      { ...VIENNA_STOREY_ADDITION, plot_register_number: 'EZ 1234, KG Hernals', 'heritage_protection@bldg1': 'no' },
      { zoning: 'residential', development_plan: 'yes', hazard_zones: ['none'], noise_situation: 'road' },
      ['plot_area']
    ),
    location: FIXTURE_LOCATION,
  },
} as const satisfies Record<string, RegisterInput>

const REGISTER_READY = snapshotOf('ready')

/** The review after the reading: decisive questions and the location's documents. */
export const QUESTIONS_READY: IntakeView = { ...INTAKE_READY, locationRegister: REGISTER_READY }

/** The address was typed and no geocoder answered: the Bundesland and the Vorhaben are asked first. */
export const QUESTIONS_TYPED_ADDRESS: IntakeView = {
  ...INTAKE_READY,
  location: null,
  questions: [],
  openQuestions: [OPEN_PHASE],
  locationRegister: snapshotOf('typedAddress'),
}

/** The agent still reads: the round says so and takes what is already known. */
export const QUESTIONS_READING: IntakeView = { ...INTAKE_READING, locationRegister: REGISTER_READY }

/** A past project: no Bundesland was found, so it is the one question; no document is requested. */
export const QUESTIONS_CLOSING: IntakeView = {
  ...INTAKE_CLOSING,
  location: null,
  locationRegister: snapshotOf('closing'),
}

/** Everything settled: every request has its values, every decisive question an answer. */
export const QUESTIONS_DONE: IntakeView = {
  ...INTAKE_READY,
  contradictions: [],
  questions: [],
  openQuestions: [],
  locationRegister: snapshotOf('done'),
}

export const QUESTIONS_FIXTURES = {
  ready: QUESTIONS_READY,
  'typed-address': QUESTIONS_TYPED_ADDRESS,
  reading: QUESTIONS_READING,
  closing: QUESTIONS_CLOSING,
  done: QUESTIONS_DONE,
} as const satisfies Record<string, IntakeView>

export type QuestionsFixtureName = keyof typeof QUESTIONS_FIXTURES
