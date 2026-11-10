/**
 * The building law a turn carries (ADR-0168, design §5.5 steps 1, 6 and 8):
 * the chain text for the project's site and the role of every edition on it,
 * read from the platform's records, on every turn since the cut-over (ADR-0175).
 *
 * Fails closed: no project, no stated Land, no released law on the chain, or a
 * graph that hit its bound yields no chain, and the knowledge context's gate
 * says what the turn may claim.
 */

import 'server-only'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import { officeTimeZone } from '@/lib/organizations/time-zone'
import { calendarDayIn } from '@/lib/format'
import { projectTerritory } from '../office/authority'
import { loadGraph } from './load'
import { buildingLawTurn, type BuildingLawTurn } from './wire'

/** Times one phase of the turn context's load (`TurnContextTiming.time`); the identity when nobody measures. */
export type PhaseTimer = <T>(name: string, load: () => Promise<T>) => Promise<T>

const untimed: PhaseTimer = (_name, load) => load()

/** The turn's building law, or null; timed as the `building-law` phase. */
export async function buildingLawForTurn(
  organizationId: string,
  projectId: string | null,
  time: PhaseTimer = untimed,
): Promise<BuildingLawTurn | null> {
  if (!projectId) return null
  return time('building-law', async () => {
    const profile = await findProjectProfileInOrg(projectId, organizationId)
    const facts = profile?.profile?.facts ?? {}
    const territory = projectTerritory({ federalState: facts.federal_state?.value, country: facts.country?.value })
    if (!territory.territoryId) return null
    const [{ graph, truncated }, zone] = await Promise.all([loadGraph(organizationId, territory.territoryId), officeTimeZone(organizationId)])
    if (truncated) return null
    return buildingLawTurn(graph, territory.territoryId, calendarDayIn(zone), territory.label ?? territory.territoryId)
  })
}
