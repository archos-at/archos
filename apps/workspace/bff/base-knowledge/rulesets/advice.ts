/**
 * The advice policy and the terminology of a site (design §3.7, §5.5 and
 * §9b(b), ADR-0174). Pure: the caller hands in the rulesets in force and the
 * site's territory chain, leaf first, as for {@link selectRecord}.
 *
 * Unlike a decision table, neither is decided by one node:
 * - **Advice policy: a union by depth, the strictest code wins per topic.**
 *   `de` may hedge deadlines and `de-by` decline contract drafting; a Bavarian
 *   answer does both. An office's own policy joins the same union, so it can
 *   only tighten, never loosen (design §5.5). A topic no policy states is
 *   `hedge`: nothing is asserted that no policy allows (fail closed), and an
 *   answer is never silenced by a gap either.
 * - **Terminology: the nearest node's gloss wins per term and language.**
 *
 * What reaches a prompt is the rendered hedges (fixed templates keyed by code,
 * {@link HEDGE_TEMPLATES}) and the capped term pairs, never a record's prose.
 */

import type { AdvicePolicy, Terminology } from '@/lib/base-knowledge/wire/advice'
import { ADVICE_MODES, ADVICE_TOPICS, type AdviceMode, type AdviceTopic } from '@/lib/base-knowledge/wire/vocab'
import { RulesetEvaluationError } from './expression'
import type { StoredRuleset } from './select'

/** What a topic falls back to when no policy on the chain states it. */
export const UNSTATED_MODE: AdviceMode = 'hedge'

/**
 * The one text each code renders to, in English: what the agent reads, never
 * what the record says. A new topic or mode is a code change reviewed here.
 */
export const HEDGE_TEMPLATES: Readonly<Record<AdviceTopic, Readonly<Record<AdviceMode, string>>>> = {
  provision_application: {
    assert: 'You may state a provision and apply it to the facts the person stated.',
    hedge: 'State the provision, and say that applying it to this case needs an individual assessment.',
    decline: 'Do not apply provisions to the case; name the provision and who decides on it.',
  },
  individual_assessment: {
    assert: 'You may give an assessment of the individual case from the stated facts.',
    hedge: 'Say that an assessment of the individual case needs a qualified professional.',
    decline: 'Do not assess the individual case; say who can.',
  },
  deadlines: {
    assert: 'You may compute deadlines from the stated dates and the provision.',
    hedge: 'Name the deadline rule, and say that the binding date must be confirmed with the authority or a lawyer.',
    decline: 'Do not compute deadlines; name the rule and who confirms the date.',
  },
  authority_discretion: {
    assert: 'You may say how the authority usually decides where it has discretion.',
    hedge: 'Where the authority has discretion, say so, and do not predict its decision.',
    decline: 'Do not speak to how the authority will use its discretion.',
  },
  contract_drafting: {
    assert: 'You may draft contract clauses.',
    hedge: 'You may outline what a contract covers, and say that its wording needs a lawyer.',
    decline: 'Do not draft or word contracts; say that this needs a lawyer.',
  },
  representation: {
    assert: 'You may draft submissions to an authority on the person’s behalf.',
    hedge: 'You may outline a submission, and say that representing the person needs a lawyer.',
    decline: 'Do not draft submissions that represent the person before an authority or a court; say who may.',
  },
}

const STRICTNESS: Readonly<Record<AdviceMode, number>> = Object.fromEntries(
  ADVICE_MODES.map((mode, index) => [mode, index]),
) as Record<AdviceMode, number>

export interface ComposedAdvicePolicy {
  /** Every topic, each with its code: stated by the strictest policy on the chain, else {@link UNSTATED_MODE}. */
  topics: Record<AdviceTopic, AdviceMode>
  /** The topics no policy on the chain states. */
  unstated: AdviceTopic[]
  /** The rulesets that contributed, in chain order. */
  rulesetIds: string[]
}

function validOn(ruleset: StoredRuleset, on: string): boolean {
  return ruleset.values.validFrom <= on && (ruleset.values.validTo === null || on < ruleset.values.validTo)
}

function requireIsoDate(on: string) {
  // Validity compares ISO dates as text, which is only right for an ISO date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new RulesetEvaluationError(`on is an ISO date, found ${on}`)
}

/** The rulesets of `kind` in force on `on` at each node of the chain, leaf first. */
function onChain<K extends 'advice_policy' | 'terminology'>(
  rulesets: readonly StoredRuleset[],
  chain: readonly string[],
  on: string,
  kind: K,
) {
  requireIsoDate(on)
  return chain.flatMap((territoryId) =>
    rulesets.filter(
      (ruleset) =>
        ruleset.values.purpose === kind &&
        ruleset.values.body.kind === kind &&
        ruleset.values.territoryIds.includes(territoryId) &&
        validOn(ruleset, on),
    ),
  )
}

/** The union of every advice policy on the chain, strictest per topic. */
export function composeAdvicePolicy(
  rulesets: readonly StoredRuleset[],
  query: { chain: readonly string[]; on: string },
): ComposedAdvicePolicy {
  const stated = new Map<AdviceTopic, AdviceMode>()
  const rulesetIds: string[] = []
  for (const ruleset of onChain(rulesets, query.chain, query.on, 'advice_policy')) {
    const { body } = ruleset.values
    if (body.kind !== 'advice_policy') continue
    if (!rulesetIds.includes(ruleset.id)) rulesetIds.push(ruleset.id)
    for (const [topic, mode] of Object.entries((body.payload as AdvicePolicy).topics) as [AdviceTopic, AdviceMode][]) {
      const current = stated.get(topic)
      if (current === undefined || STRICTNESS[mode] > STRICTNESS[current]) stated.set(topic, mode)
    }
  }
  const topics = Object.fromEntries(ADVICE_TOPICS.map((topic) => [topic, stated.get(topic) ?? UNSTATED_MODE])) as Record<
    AdviceTopic,
    AdviceMode
  >
  return { topics, unstated: ADVICE_TOPICS.filter((topic) => !stated.has(topic)), rulesetIds }
}

/** A hedge code as the prompt carries it: `<topic>:<mode>`, the key the `advice_policy_held` score compares. */
export type HedgeCode = `${AdviceTopic}:${AdviceMode}`

export function hedgeCodes(policy: ComposedAdvicePolicy): HedgeCode[] {
  return ADVICE_TOPICS.map((topic) => `${topic}:${policy.topics[topic]}` as HedgeCode)
}

/** The lines a prompt carries for the policy: one fixed template per topic. */
export function renderHedges(policy: ComposedAdvicePolicy): string[] {
  return ADVICE_TOPICS.map((topic) => HEDGE_TEMPLATES[topic][policy.topics[topic]])
}

export interface TermPair {
  language: string
  term: string
  gloss: string
  rulesetId: string
}

/**
 * The term pairs for `languages` on the chain: per language and term, the
 * nearest node's gloss. A language matches its own tag and its region's
 * (`de` takes `de` and `de-CH` pairs when `de-CH` is asked; `de-CH` takes `de`
 * pairs too), and nothing else.
 */
export function composeTerminology(
  rulesets: readonly StoredRuleset[],
  query: { chain: readonly string[]; on: string; languages: readonly string[] },
): TermPair[] {
  const wanted = (tag: string) =>
    query.languages.some((language) => language === tag || language.split('-')[0] === tag || tag.split('-')[0] === language)
  const chosen = new Map<string, TermPair>()
  for (const ruleset of onChain(rulesets, query.chain, query.on, 'terminology')) {
    const { body } = ruleset.values
    if (body.kind !== 'terminology') continue
    for (const entry of (body.payload as Terminology).entries) {
      if (!wanted(entry.language)) continue
      const key = `${entry.language}|${entry.term.toLocaleLowerCase('und')}`
      // Leaf first: the first pair seen for a term is the nearest node's.
      if (!chosen.has(key)) chosen.set(key, { ...entry, rulesetId: ruleset.id })
    }
  }
  return [...chosen.values()]
}
