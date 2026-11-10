/**
 * Whether an authority directive belongs to a project's building authority
 * (ADR-0163). Pure.
 *
 * The interim path of design §8.1: until competence rulesets resolve the
 * authority from a confirmed site, the project's Land from its intake profile
 * stands for the territory the authority decides in, and a directive applies
 * when one of its addressees is competent there (MA 37 for AT-9). The answer
 * says the authority came from the project's details and was not verified.
 */

import type { Addressee } from '../wire'
import { FEDERAL_STATE_TERRITORIES } from './reading'

/** Where the project is, as far as its profile says. */
export interface ProjectTerritory {
  /** ISO 3166-2 of the Land (`AT-9`), or ISO 3166-1 alone for a country without a Land (`DE`); null when unknown. */
  territoryId: string | null
  /** The intake token the territory came from, for the sentence the agent reads. */
  label: string | null
}

export type DirectiveApplicability =
  | { verdict: 'applies'; authority: string; territoryId: string }
  | { verdict: 'does_not_apply'; territoryId: string }
  | { verdict: 'authority_unknown' }

/** The project's territory from its profile facts (`federal_state`, `country`). */
export function projectTerritory(facts: {
  federalState?: unknown
  country?: unknown
}): ProjectTerritory {
  const state = typeof facts.federalState === 'string' ? facts.federalState : null
  if (state && FEDERAL_STATE_TERRITORIES[state])
    return { territoryId: FEDERAL_STATE_TERRITORIES[state], label: state }
  const country = typeof facts.country === 'string' ? facts.country : null
  if (country && /^[a-z]{2}$/.test(country) && country !== 'at')
    return { territoryId: country.toUpperCase(), label: country }
  return { territoryId: null, label: null }
}

/** `AT-9` lies in `AT-9` and in `AT`. */
function contains(outer: string, inner: string): boolean {
  return inner === outer || inner.startsWith(`${outer}-`)
}

export function directiveApplicability(
  addressees: readonly Addressee[],
  project: ProjectTerritory
): DirectiveApplicability {
  // Neither side known, nothing to match: the answer says the authority is unknown.
  if (!project.territoryId || addressees.length === 0) return { verdict: 'authority_unknown' }
  const competent = addressees.find((addressee) =>
    contains(addressee.territoryId, project.territoryId as string)
  )
  if (competent)
    return { verdict: 'applies', authority: competent.name, territoryId: project.territoryId }
  return { verdict: 'does_not_apply', territoryId: project.territoryId }
}
