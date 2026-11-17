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
import { readSetupRecords } from './setup-records'
import {
  buildingClassificationOf,
  classificationInputs,
  factSourcesOf,
  hasSetupRecords,
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

function unclassifiedStatus(profile: ProjectProfile, scope: SetupScope): 'site_unknown' | 'not_published' | 'no_classification' {
  const stated = siteCountry(profile)
  if (scope.chain.length === 0 && stated === null) return 'site_unknown'
  const country = scope.chain.length > 0 ? scope.chain[scope.chain.length - 1] : stated?.toUpperCase()
  return country && /^[A-Z]{2}$/.test(country) && !hasSetupRecords(scope.records, country, scope.on) ? 'not_published' : 'no_classification'
}

export function evaluateClassification(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  input: ClassificationEvaluateRequest,
  records: readonly StoredRuleset[]
): ClassificationEvaluation {
  const request = classificationEvaluateRequestSchema.parse(input)
  const scope = setupScopeOf(profile, { records, on: request.on })
  const classification = buildingClassificationOf(scope)
  const site = { chain: [...scope.chain] }
  if (!classification) {
    const status = unclassifiedStatus(profile, scope)
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

export async function evaluateProjectClassification(
  session: AuthorizedSession,
  projectId: string,
  input: ClassificationEvaluateRequest
): Promise<ClassificationEvaluation> {
  await requireProjectAccess(session, projectId, 'project:view')
  const state = await findProjectProfileInOrg(projectId, session.organizationId)
  if (!state) throw new NotFoundError()
  const { gate } = await contextForPage(session.organizationId, projectId)
  if (!gateNamesLaw(gate.state)) {
    const withheld = { state: gate.state, reason: gate.reason }
    return { status: 'undetermined', gate: withheld, site: { chain: [] }, classification: null, planned: null, existing: null, shift: null, requests: [] }
  }
  return evaluateClassification(state.profile, projectIntakeDefinitionV1, input, await readSetupRecords(session.organizationId))
}

export async function lawWithheldAt(organizationId: string, projectId: string): Promise<boolean> {
  const { gate } = await contextForPage(organizationId, projectId)
  return !gateNamesLaw(gate.state)
}
