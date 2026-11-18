import type { ProjectLaw } from '@/lib/base-knowledge/wire/project-law'
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

const OIB_PAGE = 'https://www.oib.or.at/kernaufgaben/oib-richtlinien/'

export const LAW_VIENNA: ProjectLaw = {
  gate: 'core',
  uses: [
    { workId: 'work:at-wien-bo', editionId: 'edition:at-wien-bo-2023', role: 'binding', qualifier: null, designation: 'BO für Wien', editionLabel: 'LGBl. Nr. 37/2023', applicability: null, sourceUrl: null },
    { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2023', role: 'binding', qualifier: null, designation: 'OIB-RL 2', editionLabel: '2023', applicability: null, sourceUrl: OIB_PAGE },
    {
      workId: 'work:oib-rl-2-2',
      editionId: 'edition:oib-rl-2-2-2023',
      role: 'binding',
      qualifier: null,
      designation: 'OIB-RL 2.2',
      editionLabel: '2023',
      applicability: { verdict: 'applies', basis: ['uses'], open: [], provision: 'OIB-Richtlinie 2.2 (Ausgabe Mai 2023): Anwendungsbereich' },
      sourceUrl: OIB_PAGE,
    },
    {
      workId: 'work:oib-rl-2-3',
      editionId: 'edition:oib-rl-2-3-2023',
      role: 'binding',
      qualifier: null,
      designation: 'OIB-RL 2.3',
      editionLabel: '2023',
      applicability: { verdict: 'check', basis: [], open: ['escape_level_m'], provision: null },
      sourceUrl: OIB_PAGE,
    },
    { workId: 'work:oib-rl-4', editionId: 'edition:oib-rl-4-2023', role: 'binding', qualifier: null, designation: 'OIB-RL 4', editionLabel: '2023', applicability: null, sourceUrl: OIB_PAGE },
    { workId: 'work:oenorm-b-1600', editionId: 'edition:oenorm-b-1600-2017', role: 'guidance', qualifier: null, designation: 'ÖNORM B 1600', editionLabel: '2017', applicability: null, sourceUrl: null },
    { workId: 'work:oib-erl-2', editionId: 'edition:oib-erl-2-2023', role: 'interpretation', qualifier: null, designation: 'OIB-RL 2 Erläuterungen', editionLabel: '2023', applicability: null, sourceUrl: null },
  ],
  factLabels: { uses: 'Nutzungen', escape_level_m: 'Fluchtniveau' },
}

const confirm = (item: Suggestion): Suggestion => ({ ...item, state: 'confirmed', alternatives: [], decisive: false })

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

export const PROFILE_SITE_UNKNOWN: IntakeView = { ...PROFILE_REVIEW, applicableLaw: { gate: 'site_unknown', uses: [], factLabels: {} } }

export const PROFILE_UNCURATED: IntakeView = {
  ...PROFILE_REVIEW,
  applicableLaw: {
    gate: 'open',
    uses: [
      { workId: 'work:at-wien-bo', editionId: null, role: 'binding', qualifier: 'uncurated', designation: 'BO für Wien', editionLabel: null, applicability: null, sourceUrl: null },
      { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2023', role: 'information', qualifier: null, designation: 'OIB-RL 2', editionLabel: '2023', applicability: null, sourceUrl: null },
    ],
    factLabels: {},
  },
}

export const PROFILE_NOT_ENTITLED: IntakeView = { ...PROFILE_REVIEW, applicableLaw: { gate: 'not_entitled', uses: [], factLabels: {} } }

export const PROFILE_READONLY: IntakeView = { ...PROFILE_REVIEW, canDecide: false, canComplete: false }

export const PROFILE_STEP_FIXTURES = {
  review: PROFILE_REVIEW,
  confirmed: PROFILE_CONFIRMED,
  highRise: PROFILE_HIGH_RISE,
  siteUnknown: PROFILE_SITE_UNKNOWN,
  notEntitled: PROFILE_NOT_ENTITLED,
  uncurated: PROFILE_UNCURATED,
  readonly: PROFILE_READONLY,
} as const

export type ProfileStepFixtureName = keyof typeof PROFILE_STEP_FIXTURES
