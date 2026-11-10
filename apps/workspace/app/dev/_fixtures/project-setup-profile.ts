/**
 * Step 5, Steckbrief: fixtures for `/dev/project-setup?step=profile&state=<name>`
 * and the step's specs. They build on the review fixtures
 * (`project-intake.ts`), the Aufstockung in Wien, and add what this step shows
 * of its own: the law at the site as the server reads it from the platform's
 * records (`projectLawFor`; synthetic editions for Vienna, not the Austria
 * pack's), a value two documents agree on, a high-rise, a Steckbrief with
 * nothing left open, and the two refusals a person meets most.
 *
 *   - `review`: a contradiction (one quiet line to the Rückfragen), two
 *     decisive values heading the findings table, the rest folded by topic,
 *     the class suggested for Bauwerk 1 and open for Bauwerk 2, and the law
 *     in Vienna by the records.
 *   - `confirmed`: every decisive value and the class taken („Von Ihnen“),
 *     the rest still suggestions.
 *   - `hochhaus`: Bauwerk 1's Fluchtniveau is confirmed above 22 m, so it has
 *     no class.
 *   - `siteUnknown`: no site yet, so the card names no law and says why.
 *   - `notEntitled`: a site in a country the office is not entitled to.
 *   - `readonly`: the review for someone who may look but not decide.
 */

import type { ProjectLaw } from '@/lib/base-knowledge/context/operations-wire'
import type { DerivationReview, IntakeView, Suggestion, SuggestionGroup } from '@/lib/project-intake/types'
import {
  DERIVATION_OPEN,
  DERIVATION_READY,
  fromDocument,
  INTAKE_READY,
  SUGGESTION_CLASS,
  SUGGESTION_ESCAPE_LEVEL,
  SUGGESTION_STOREYS,
  SUGGESTION_UNITS,
} from './project-intake'

/** The law in Vienna as `projectLawFor` answers it: binding law and guidance by the chain (synthetic editions). */
export const LAW_VIENNA: ProjectLaw = {
  gate: 'core',
  uses: [
    { workId: 'work:at-wien-bo', editionId: 'edition:at-wien-bo-2023', role: 'binding', designation: 'BO für Wien', editionLabel: 'LGBl. Nr. 37/2023' },
    { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2023', role: 'binding', designation: 'OIB-RL 2', editionLabel: '2023' },
    { workId: 'work:oib-rl-4', editionId: 'edition:oib-rl-4-2023', role: 'binding', designation: 'OIB-RL 4', editionLabel: '2023' },
    { workId: 'work:oenorm-b-1600', editionId: 'edition:oenorm-b-1600-2017', role: 'guidance', designation: 'ÖNORM B 1600', editionLabel: '2017' },
    { workId: 'work:oib-erl-2', editionId: 'edition:oib-erl-2-2023', role: 'interpretation', designation: 'OIB-RL 2 Erläuterungen', editionLabel: '2023' },
  ],
}

const confirm = (item: Suggestion): Suggestion => ({ ...item, state: 'confirmed', alternatives: [], decisive: false })

/** The Fluchtniveau, read from the Schnitt and the Baubeschreibung alike: two sources agree. */
export const SUGGESTION_ESCAPE_LEVEL_CORROBORATED: Suggestion = {
  ...SUGGESTION_ESCAPE_LEVEL,
  evidence: [
    ...SUGGESTION_ESCAPE_LEVEL.evidence,
    fromDocument('Baubeschreibung.pdf', 2, 'Das Fluchtniveau des obersten Geschoßes liegt bei 18,40 m.'),
  ],
}

const withItems = (groups: readonly SuggestionGroup[], replace: (item: Suggestion) => Suggestion): SuggestionGroup[] =>
  groups.map((group) => ({ ...group, items: group.items.map(replace) }))

const REVIEW_GROUPS = withItems(INTAKE_READY.groups, (item) =>
  item.key === SUGGESTION_ESCAPE_LEVEL.key ? SUGGESTION_ESCAPE_LEVEL_CORROBORATED : item
)

/** The review as step 5 shows it: contradiction, decisive values, the rest, the class to take, the general Ampel. */
export const PROFILE_REVIEW: IntakeView = {
  ...INTAKE_READY,
  groups: REVIEW_GROUPS,
  applicableLaw: LAW_VIENNA,
}

const DECIDED = new Set([SUGGESTION_STOREYS.key, SUGGESTION_ESCAPE_LEVEL.key, SUGGESTION_UNITS.key])

const CLASS_CONFIRMED: DerivationReview = {
  ...DERIVATION_READY,
  inputs: DERIVATION_READY.inputs.map((input) => ({ ...input, suggested: input.key.startsWith('building_type') })),
  suggestion: confirm(SUGGESTION_CLASS),
}

/** The decisive values and the class taken; the rest still suggestions; nothing open. */
export const PROFILE_CONFIRMED: IntakeView = {
  ...PROFILE_REVIEW,
  counts: { ...PROFILE_REVIEW.counts, contradictions: 0, decisiveOpen: 0, suggested: 3 },
  contradictions: [],
  questions: [],
  groups: withItems(REVIEW_GROUPS, (item) => (DECIDED.has(item.key) ? confirm(item) : item)),
  derivations: [CLASS_CONFIRMED],
}

const ESCAPE_LEVEL_HIGH: Suggestion = {
  ...SUGGESTION_ESCAPE_LEVEL,
  value: 24.6,
  display: '24.6 m',
  state: 'confirmed',
  decisive: false,
  evidence: [fromDocument('E-02 Schnitt A-A.pdf', 1, 'Fluchtniveau +24,60 m über Gelände')],
}

/** Bauwerk 1 is a high-rise: no class. */
export const PROFILE_HIGH_RISE: IntakeView = {
  ...PROFILE_CONFIRMED,
  groups: withItems(PROFILE_CONFIRMED.groups, (item) => (item.key === ESCAPE_LEVEL_HIGH.key ? ESCAPE_LEVEL_HIGH : item)),
  derivations: [
    {
      ...DERIVATION_READY,
      value: null,
      highRise: true,
      inputs: DERIVATION_READY.inputs.map((input) =>
        input.key === ESCAPE_LEVEL_HIGH.key ? { ...input, value: 24.6, suggested: false } : input
      ),
      suggestion: null,
    },
    DERIVATION_OPEN,
  ],
}

/** No site yet: the card says what is missing instead of naming law. */
export const PROFILE_SITE_UNKNOWN: IntakeView = { ...PROFILE_REVIEW, applicableLaw: { gate: 'site_unknown', uses: [] } }

/** A site in a country the office is not entitled to: no law named, the office's own documents still answer. */
export const PROFILE_NOT_ENTITLED: IntakeView = { ...PROFILE_REVIEW, applicableLaw: { gate: 'not_entitled', uses: [] } }

/** Someone who may look at the Steckbrief but not decide on it. */
export const PROFILE_READONLY: IntakeView = { ...PROFILE_REVIEW, canDecide: false, canComplete: false }

export const PROFILE_STEP_FIXTURES = {
  review: PROFILE_REVIEW,
  confirmed: PROFILE_CONFIRMED,
  highRise: PROFILE_HIGH_RISE,
  siteUnknown: PROFILE_SITE_UNKNOWN,
  notEntitled: PROFILE_NOT_ENTITLED,
  readonly: PROFILE_READONLY,
} as const

export type ProfileStepFixtureName = keyof typeof PROFILE_STEP_FIXTURES
