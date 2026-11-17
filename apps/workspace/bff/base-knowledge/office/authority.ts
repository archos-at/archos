import type { Addressee } from '../wire'
import type { SubdivisionTerritories } from './reading'

export interface ProjectTerritory {
  territoryId: string | null
  label: string | null
}

export type DirectiveApplicability =
  | { verdict: 'applies'; authority: string; territoryId: string }
  | { verdict: 'does_not_apply'; territoryId: string }
  | { verdict: 'authority_unknown' }

export function projectTerritory(facts: { federalState?: unknown; country?: unknown }, subdivisions: SubdivisionTerritories): ProjectTerritory {
  const state = typeof facts.federalState === 'string' ? facts.federalState : null
  if (state && subdivisions[state]) return { territoryId: subdivisions[state], label: state }
  const country = typeof facts.country === 'string' ? facts.country : null
  const subdivided = (code: string) => Object.values(subdivisions).some((territoryId) => territoryId.startsWith(`${code}-`))
  if (Object.keys(subdivisions).length > 0 && country && /^[a-z]{2}$/.test(country) && !subdivided(country.toUpperCase())) return { territoryId: country.toUpperCase(), label: country }
  return { territoryId: null, label: null }
}

function contains(outer: string, inner: string): boolean {
  return inner === outer || inner.startsWith(`${outer}-`)
}

export function directiveApplicability(addressees: readonly Addressee[], project: ProjectTerritory): DirectiveApplicability {
  if (!project.territoryId || addressees.length === 0) return { verdict: 'authority_unknown' }
  const competent = addressees.find((addressee) => contains(addressee.territoryId, project.territoryId as string))
  if (competent) return { verdict: 'applies', authority: competent.name, territoryId: project.territoryId }
  return { verdict: 'does_not_apply', territoryId: project.territoryId }
}
