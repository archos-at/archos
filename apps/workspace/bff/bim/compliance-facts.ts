/**
 * The project facts a compliance run reads beside the elements: where the
 * project is, and the model's storeys. Split from `query.ts`.
 */

import 'server-only'
import { siteOfProfile } from '@/lib/project-intake/setup-scope'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import type { BimModelHeader } from './repository'
import type { BimSite } from './rules'

/**
 * Where the model's project is (ADR-0169): the chain its profile gives. A model
 * in no project, or a project nothing places, has no site, and every rule's
 * elements are then undecidable rather than judged by Austrian law by default.
 */
export async function siteOfModel(header: BimModelHeader, organizationId: string): Promise<BimSite> {
  if (!header.projectId) return null
  const state = await findProjectProfileInOrg(header.projectId, organizationId)
  if (!state) return null
  return siteOfProfile(state.profile)
}

/** The cache's spelling of a site. */
export const siteKey = (site: BimSite) => (site ? site.chain.join('>') || 'nowhere' : 'unplaced')

/**
 * Storey names and elevations for the rule catalogue.
 *
 * OIB 2 Tabelle 1b asks a different fire-resistance duration of a
 * Kellergeschoß wall than of a ground-floor one; without this a rule cannot
 * tell them apart and has to report the requirement as undetermined.
 */
export function storeyFacts(
  summary: BimModelHeader['summary']
): Array<{ name: string; elevation: number | null }> | undefined {
  return summary?.storeys.map((storey) => ({
    name: storey.name ?? '',
    elevation: storey.elevation,
  }))
}
