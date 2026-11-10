/**
 * The building law a turn carries (ADR-0168, design §5.5 steps 1, 6 and 8):
 * the chain text for the project's site and the role of every edition on it,
 * read from the platform's records. Behind `building-law-chain` per
 * organization; with it off the turn carries nothing new.
 *
 * Fails closed: no project, no stated Land, no released law on the chain, or a
 * graph that hit its bound yields no chain, and the agent keeps what it had
 * (the static prompt's block, or for a site outside it, the jurisdiction note).
 */

import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import { officeTimeZone } from '@/lib/organizations/time-zone'
import { calendarDayIn } from '@/lib/format'
import { projectTerritory } from '../office/authority'
import { loadGraph } from './load'
import { buildingLawTurn, type BuildingLawTurn } from './wire'

export async function buildingLawForTurn(organizationId: string, projectId: string | null): Promise<BuildingLawTurn | null> {
  if (!projectId || !(await isOrgFeatureEnabled(FEATURE_FLAGS.buildingLawChain, organizationId))) return null
  const profile = await findProjectProfileInOrg(projectId, organizationId)
  const facts = profile?.profile?.facts ?? {}
  const territory = projectTerritory({ federalState: facts.federal_state?.value, country: facts.country?.value })
  if (!territory.territoryId) return null
  const [{ graph, truncated }, zone] = await Promise.all([loadGraph(organizationId, territory.territoryId), officeTimeZone(organizationId)])
  if (truncated) return null
  return buildingLawTurn(graph, territory.territoryId, calendarDayIn(zone), territory.label ?? territory.territoryId)
}
