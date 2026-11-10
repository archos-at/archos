/**
 * What a turn carries of the building law (ADR-0168): the chain text the agent
 * reads, and per edition its role, as tokens the answer's renderer and
 * `citations/binding.py` key on. Pure and zod, shared by the turn-context
 * route and its spec; the Python tier parses the same shape
 * (`turn/context_client.py`).
 */

import type { SiteAuthority } from '@/lib/site-resolution/wire'
import { z } from 'zod'
import { EDITION_ROLES } from '../wire/vocab'
import type { KnowledgeGraph } from './graph'
import { resolveChain } from './resolve'
import { nameOf, renderChainText } from './text'

/** Most uses a turn carries; the resolver's own bound. */
export const MAX_TURN_USES = 40

export const buildingLawUseSchema = z
  .object({
    workId: z.string(),
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    qualifier: z.enum(['office_maintained']).nullable(),
    /** How the role arose: law in its territory, or a relation's route. */
    via: z.enum(['territory', 'relation', 'none']),
    /** The base-corpus files of the edition: the id map from a retrieved passage to its edition. */
    corpusFiles: z.array(z.string()),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
  })
  .strict()

export const buildingLawTurnSchema = z
  .object({
    /** The chain text, for the `<building_law>` block of a turn whose static prompt has none. */
    text: z.string(),
    /** The site's leaf, then every territory it lies in at the date. */
    chain: z.array(z.string()),
    date: z.iso.date(),
    uses: z.array(buildingLawUseSchema).max(MAX_TURN_USES),
  })
  .strict()

export type BuildingLawUse = z.infer<typeof buildingLawUseSchema>
export type BuildingLawTurn = z.infer<typeof buildingLawTurnSchema>

/** The turn's building law for a site, or null when nothing binds there by the records or the resolution was truncated (fail closed). */
export function buildingLawTurn(
  graph: KnowledgeGraph,
  leafId: string,
  date: string,
  place: string,
  competence: SiteAuthority | null = null,
): BuildingLawTurn | null {
  const resolved = resolveChain(graph, leafId, date, { competence })
  // A truncated resolution would leave some cited editions with no role, read as the old guess: none at all.
  if (resolved.truncated) return null
  const lawHere = resolved.uses.some((use) => use.role === 'binding' && use.route[0]?.via === 'territory' && use.route.length === 1)
  if (!lawHere) return null
  return {
    text: renderChainText(graph, resolved, place),
    chain: [...resolved.chain],
    date,
    uses: resolved.uses.slice(0, MAX_TURN_USES).map((use) => {
      const edition = use.editionId ? graph.editions.get(use.editionId) : undefined
      const work = graph.works.get(use.workId)
      return {
        workId: use.workId,
        editionId: use.editionId,
        role: use.role,
        qualifier: use.qualifier,
        via: use.route.at(-1)?.via ?? 'none',
        corpusFiles: [...(edition?.corpusFiles ?? [])],
        designation: work?.designation ? nameOf(work.designation) : null,
        editionLabel: edition ? nameOf(edition.label) : null,
      }
    }),
  }
}
