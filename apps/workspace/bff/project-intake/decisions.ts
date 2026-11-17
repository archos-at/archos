import { validateProfilePatchVocabulary } from '@/lib/project-profile/intake-vocabulary'
import type { ProfileAlternative, ProfileEvidence } from '@/lib/project-profile/evidence-schema'
import type { ProjectAssumption, ProjectFact, ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { reasonFromEvidence } from './evidence'
import { confirmedFact, pointerSegment, suggestedAssumption, withoutAlternative } from './profile-edits'
import type { DismissedValue, IntakeDecision, IntakeDecisionResult } from './types'

export const DECISION_REFUSALS = {
  nothingToConfirm: 'nothing-to-confirm',
  nothingToDismiss: 'nothing-to-dismiss',
  noSuchAlternative: 'no-such-alternative',
  vocabulary: 'vocabulary',
} as const

export interface ScoredDecision {
  key: string
  alternativeIndex: number | null
  decision: 'accepted' | 'dismissed'
}

export interface DecisionPlan {
  profile: ProjectProfile
  results: IntakeDecisionResult[]
  changedKeys: string[]
  dismissed: DismissedValue[]
  scored: ScoredDecision[]
}

interface Step {
  profile: ProjectProfile
  result: IntakeDecisionResult
  dismissed?: DismissedValue
  scored?: ScoredDecision
}

const refuse = (profile: ProjectProfile, key: string, reason: string): Step => ({
  profile,
  result: { key, ok: false, reason },
})

function fromReading(entry: { evidence?: ProfileEvidence[] }, assumption?: ProjectAssumption): boolean {
  if (assumption?.source === 'agent_suggested') return true
  return (entry.evidence ?? []).some((evidence) => evidence.kind === 'document' || evidence.kind === 'derivation')
}

function holderOf(profile: ProjectProfile, key: string): ProjectFact | ProjectAssumption | undefined {
  return profile.facts[key] ?? profile.assumptions[key]
}

function withFact(profile: ProjectProfile, key: string, fact: ProjectFact): ProjectProfile {
  return { ...profile, facts: { ...profile.facts, [key]: fact } }
}

function confirmAlternative(profile: ProjectProfile, key: string, index: number, now: string): Step {
  const holder = holderOf(profile, key)
  const alternative = holder?.alternatives?.[index]
  if (!holder || !alternative) return refuse(profile, key, DECISION_REFUSALS.noSuchAlternative)
  const fact = confirmedFact(alternative.value, alternative.evidence, now)
  return {
    profile: withFact(profile, key, fact),
    result: { key, ok: true },
    scored: { key, alternativeIndex: index, decision: 'accepted' },
  }
}

function confirm(profile: ProjectProfile, key: string, now: string): Step {
  const fact = profile.facts[key]
  if (fact) {
    const settled: ProjectFact = { ...fact }
    delete settled.alternatives
    return { profile: withFact(profile, key, settled), result: { key, ok: true } }
  }
  const assumption = profile.assumptions[key]
  if (!assumption) return refuse(profile, key, DECISION_REFUSALS.nothingToConfirm)
  const next = withFact(profile, key, confirmedFact(assumption.value, assumption.evidence ?? [], now))
  return {
    profile: next,
    result: { key, ok: true },
    ...(fromReading(assumption, assumption) ? { scored: { key, alternativeIndex: null, decision: 'accepted' } } : {}),
  }
}

function replaceHolder(profile: ProjectProfile, key: string, alternatives: ProfileAlternative[]): ProjectProfile {
  const fact = profile.facts[key]
  if (fact) return withFact(profile, key, { ...fact, alternatives })
  const assumption = profile.assumptions[key]
  return { ...profile, assumptions: { ...profile.assumptions, [key]: { ...assumption, alternatives } } }
}

function dismissAlternative(profile: ProjectProfile, key: string, index: number): Step {
  const holder = holderOf(profile, key)
  const alternative = holder?.alternatives?.[index]
  if (!holder || !alternative) return refuse(profile, key, DECISION_REFUSALS.noSuchAlternative)
  return {
    profile: replaceHolder(profile, key, withoutAlternative(holder.alternatives, index)),
    result: { key, ok: true },
    dismissed: { key, value: alternative.value },
    scored: { key, alternativeIndex: index, decision: 'dismissed' },
  }
}

function successorOf(assumption: ProjectAssumption, now: string): ProjectAssumption | null {
  const [next, ...rest] = assumption.alternatives ?? []
  if (!next) return null
  const document = next.evidence.find((evidence) => evidence.kind === 'document')
  const reason = document ? reasonFromEvidence(document) : assumption.reason
  return {
    ...suggestedAssumption(next.value, reason, next.evidence, now),
    ...(rest.length > 0 ? { alternatives: rest } : {}),
  }
}

function dismiss(profile: ProjectProfile, key: string, now: string): Step {
  const assumption = profile.assumptions[key]
  if (!assumption || key in profile.facts) return refuse(profile, key, DECISION_REFUSALS.nothingToDismiss)
  const assumptions = { ...profile.assumptions }
  const successor = successorOf(assumption, now)
  if (successor) assumptions[key] = successor
  else delete assumptions[key]
  return {
    profile: { ...profile, assumptions },
    result: { key, ok: true },
    dismissed: { key, value: assumption.value },
    ...(fromReading(assumption, assumption) ? { scored: { key, alternativeIndex: null, decision: 'dismissed' } } : {}),
  }
}

function answer(profile: ProjectProfile, key: string, value: ProjectPrimitiveValue, userId: string, now: string): Step {
  try {
    validateProfilePatchVocabulary([{ op: 'add', path: `/facts/${pointerSegment(key)}`, value }])
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : DECISION_REFUSALS.vocabulary
    return refuse(profile, key, reason)
  }
  const fact = confirmedFact(value, [{ kind: 'person', userId, at: now }], now)
  return { profile: withFact(profile, key, fact), result: { key, ok: true } }
}

function unknown(profile: ProjectProfile, key: string): Step {
  if (profile.unknowns.includes(key)) return { profile, result: { key, ok: true } }
  return { profile: { ...profile, unknowns: [...profile.unknowns, key] }, result: { key, ok: true } }
}

function step(profile: ProjectProfile, decision: IntakeDecision, userId: string, now: string): Step {
  switch (decision.action) {
    case 'confirm':
      return decision.alternativeIndex === undefined
        ? confirm(profile, decision.key, now)
        : confirmAlternative(profile, decision.key, decision.alternativeIndex, now)
    case 'dismiss':
      return decision.alternativeIndex === undefined
        ? dismiss(profile, decision.key, now)
        : dismissAlternative(profile, decision.key, decision.alternativeIndex)
    case 'answer':
      return answer(profile, decision.key, decision.value, userId, now)
    case 'unknown':
      return unknown(profile, decision.key)
  }
}

export function planDecisions(
  profile: ProjectProfile,
  decisions: readonly IntakeDecision[],
  context: { userId: string; now: string }
): DecisionPlan {
  let current = profile
  const plan: Omit<DecisionPlan, 'profile'> = { results: [], changedKeys: [], dismissed: [], scored: [] }
  for (const decision of decisions) {
    const done = step(current, decision, context.userId, context.now)
    current = done.profile
    plan.results.push(done.result)
    if (done.result.ok) plan.changedKeys.push(decision.key)
    if (done.dismissed) plan.dismissed.push(done.dismissed)
    if (done.scored) plan.scored.push(done.scored)
  }
  return { ...plan, profile: current, changedKeys: [...new Set(plan.changedKeys)] }
}
