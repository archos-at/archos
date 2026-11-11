/**
 * `classification-evaluate` (ADR-0169, design §5.4, E34): a building's class
 * under the classification its site selects, run twice on the one evaluator,
 * on the planned values and on the Bestand's, with the shift between them and,
 * for every input still open, the document the country's fact sources name.
 *
 * A read: nothing is written, and values passed in only try a „what if".
 * Fail closed: a project nothing places, or one in a country with no
 * classification record, gets no class, with the reason as its status; so does
 * one whose knowledge context withholds law (not entitled, unreadable, no
 * coverage), with the turn's own gate.
 */

import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { gateNamesLaw } from '@/lib/base-knowledge/wire/project-law'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { buildingClassFacts, candidateMeanings, classifyWithTable } from '@/lib/base-knowledge/rulesets/building-class'
import { evaluateDecisionTable } from '@/lib/base-knowledge/rulesets/decision-table'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import { siteCountry } from '@/lib/project-profile/site'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import {
  classificationEvaluateRequestSchema,
  type ClassificationEvaluateRequest,
  type ClassificationEvaluation,
  type ClassificationOutcome,
} from './classification-wire'
import { buildingClassInputsFor } from './needs'
import {
  buildingClassificationOf,
  classificationInputs,
  factSourcesOf,
  setupScopeOf,
  type BuildingClassification,
  type SetupScope,
} from './setup-scope'

type Inputs = Record<string, ProjectPrimitiveValue | undefined>

function outcomeOf(classification: BuildingClassification, inputs: Inputs): ClassificationOutcome {
  const { table, derivation, definitions } = classification
  const facts = buildingClassFacts(table, inputs, definitions.facts)
  const result = classifyWithTable(table, derivation, inputs, definitions.facts)
  const evaluated = evaluateDecisionTable(table, facts)
  const possible =
    evaluated.status === 'undetermined' && evaluated.reason === 'unknown_inputs'
      ? candidateMeanings(evaluated.candidates, derivation).map(({ value, hochhaus, applicable }) => ({
          value,
          highRise: hochhaus,
          applicable,
        }))
      : []
  return {
    value: result.value,
    highRise: result.hochhaus,
    applicable: result.applicable,
    inputs: { ...facts },
    missing: result.missing,
    possible,
  }
}

const valueAt = (profile: ProjectProfile, key: string) => profile.facts[key]?.value ?? profile.assumptions[key]?.value

/**
 * The Bestand's values: the planned ones, with each fact the country holds
 * twice (`existingKey`, „Bestand heute") read from its existing key. Null for a
 * building that is no Bestand, unless values for it were given.
 */
function existingInputs(
  profile: ProjectProfile,
  classification: BuildingClassification,
  planned: Inputs,
  request: { buildingId: string; existing?: Inputs }
): Inputs | null {
  const isExisting = valueAt(profile, `construction_status@${request.buildingId}`) === 'existing'
  if (!isExisting && !request.existing) return null
  const existing: Inputs = { ...planned }
  for (const fact of classification.definitions.facts) {
    if (!fact.existingKey || !(fact.key in planned)) continue
    existing[fact.key] = valueAt(profile, `${fact.existingKey}@${request.buildingId}`) ?? undefined
  }
  return { ...existing, ...request.existing }
}

function shiftOf(existing: ClassificationOutcome | null, planned: ClassificationOutcome) {
  if (!existing) return null
  const decided = (outcome: ClassificationOutcome) => outcome.missing.length === 0
  const same = (a: ClassificationOutcome, b: ClassificationOutcome) =>
    a.value === b.value && a.highRise === b.highRise && a.applicable === b.applicable
  return {
    changed: decided(existing) && decided(planned) ? !same(existing, planned) : null,
    differingInputs: Object.keys(planned.inputs).filter(
      (key) => JSON.stringify(planned.inputs[key]) !== JSON.stringify(existing.inputs[key])
    ),
  }
}

/** The document for each open input, from the country's fact sources, the subdivision's variant first. */
function requestsFor(scope: SetupScope, open: ReadonlySet<string>): ClassificationEvaluation['requests'] {
  const entries = factSourcesOf(scope)?.entries ?? []
  return entries
    .filter((entry) => entry.factKeys.some((key) => open.has(key)))
    .map((entry) => {
      const variant = entry.variants[scope.chain[0] ?? '']
      return {
        factKeys: entry.factKeys.filter((key) => open.has(key)),
        document: variant?.document ?? entry.request.document,
        reason: variant?.reason ?? entry.request.reason,
        sources: variant?.sources ?? entry.sources,
      }
    })
}

/** The evaluation for one building of one profile. Pure. */
export function evaluateClassification(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  input: ClassificationEvaluateRequest,
  records?: readonly StoredRuleset[]
): ClassificationEvaluation {
  const request = classificationEvaluateRequestSchema.parse(input)
  const scope = setupScopeOf(profile, { records, on: request.on })
  const classification = buildingClassificationOf(scope)
  const site = { chain: [...scope.chain] }
  if (!classification) {
    const status = scope.chain.length === 0 && siteCountry(profile) === null ? 'site_unknown' : 'no_classification'
    return { status, gate: null, site, classification: null, planned: null, existing: null, shift: null, requests: [] }
  }
  const fromProfile = buildingClassInputsFor(profile, definition, request.buildingId, classificationInputs(classification))
  const plannedInputs = { ...fromProfile, ...request.planned }
  const planned = outcomeOf(classification, plannedInputs)
  const existingValues = existingInputs(profile, classification, plannedInputs, request)
  const existing = existingValues ? outcomeOf(classification, existingValues) : null
  const open = new Set([...planned.missing, ...(existing?.missing ?? [])])
  return {
    status: 'evaluated',
    gate: null,
    site,
    classification: {
      rulesetId: classification.rulesetId,
      territoryId: classification.territoryId,
      rule: classification.derivation.rule,
      citation: classification.derivation.citation,
    },
    planned,
    existing,
    shift: shiftOf(existing, planned),
    requests: requestsFor(scope, open),
  }
}

/**
 * `POST /api/projects/[id]/classification-evaluations`: anyone who may view the
 * project may ask. Where the turn's gate withholds law, so does this: the class
 * is undetermined and the gate says why, as the turn would.
 */
export async function evaluateProjectClassification(
  session: AuthorizedSession,
  projectId: string,
  input: ClassificationEvaluateRequest
): Promise<ClassificationEvaluation> {
  await requireProjectAccess(session, projectId, 'project:view')
  const state = await findProjectProfileInOrg(projectId, session.organizationId)
  if (!state) throw new NotFoundError()
  // An operation's read, never the turn alert's (ADR-0173).
  const { gate } = await contextForPage(session.organizationId, projectId)
  if (!gateNamesLaw(gate.state)) {
    const withheld = { state: gate.state, reason: gate.reason }
    return { status: 'undetermined', gate: withheld, site: { chain: [] }, classification: null, planned: null, existing: null, shift: null, requests: [] }
  }
  return evaluateClassification(state.profile, projectIntakeDefinitionV1, input)
}

/**
 * Whether the project's knowledge context withholds law at its site: then the
 * intake derives and writes no Gebäudeklasse either, as this operation answers
 * (ADR-0169's amendment). An operation's read, never the turn alert's.
 */
export async function lawWithheldAt(organizationId: string, projectId: string): Promise<boolean> {
  const { gate } = await contextForPage(organizationId, projectId)
  return !gateNamesLaw(gate.state)
}
