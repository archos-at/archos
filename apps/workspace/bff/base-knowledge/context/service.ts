/**
 * The knowledge context a turn carries (design §5.5, ADR-0173), on every turn
 * since the cut-over (ADR-0175): which country an office reads is decided by
 * its entitlement rows (`knowledge_country_entitled`), never by a switch.
 *
 * The inputs that decide the context are cheap (the office row, its
 * entitlements, the project's site facts, the packs' newest stable sequence,
 * the day); the graph and its resolution are not. So the cheap ones make a
 * digest, and the resolved context is cached under
 * `knowledge-context-v3:<org>:<project>:<digest>`: the organization and the
 * project are in the key, never only in the digest, so two offices whose
 * inputs hash alike never share an entry (the tenant cache-key rule).
 *
 * Fails closed: a read that throws gives `knowledge_unavailable`, which
 * withholds retrieval, law lookup and classification while documents still
 * answer. A turn's failed read logs the `knowledge_context_available` alert
 * line; a page's logs its own marker, so a page polling an outage does not
 * fire the turn alert.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { metrics } from '@opentelemetry/api'
import { sql } from 'drizzle-orm'
import { getCached } from '@/lib/cache'
import { getDb } from '@/lib/db'
import { sqlTextArray } from '@/lib/db/sql-list'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { calendarDayIn } from '@/lib/format'
import { officeTimeZone } from '@/lib/organizations/time-zone'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import { projectBuildings } from '../chain/building'
import type { BuildingScope } from '../rulesets/applicability'
import { loadGraph } from '../chain/load'
import { readOrganizationCountries } from '../platform/entitlements'
import { procedureFromProfile, profileHasProcedure } from '../time/profile-procedure'
import { countryOf, resolveKnowledgeContext, type SiteLeaf } from './resolve'
import { lastAnswerPackSeqs, packsUpdatedSince } from './last-answer'
import { rememberTurnContext } from './turn-snapshot'
import { siteLeaves } from './site'
import { lookupSourcesFor } from './sources'
import type { KnowledgeContext, ProcedureContext } from './wire'

/** How long a resolved context is reused: the digest changes with every input that decides it, so this only bounds the cache's size. */
export const CONTEXT_TTL_MS = 10 * 60 * 1000

/** The procedures a turn carries: the profile's first, as `procedure-*` facts scope them (ADR-0171). */
const PROCEDURE_IDS = ['p1'] as const

/**
 * Turns whose knowledge context could not be read (`knowledge_context_available`
 * in design §5.5): the alert's row in the merged health insight reads it
 * (docs/observability/metrics.md). A no-op meter where nothing exports.
 */
const unavailableTurns = metrics
  .getMeter('base-knowledge')
  .createCounter('knowledge_context.unavailable', { description: 'Turns whose knowledge context could not be read' })

/** Times one phase of the turn context's load (`TurnContextTiming.time`); the identity when nobody measures. */
export type PhaseTimer = <T>(name: string, load: () => Promise<T>) => Promise<T>

const untimed: PhaseTimer = (_name, load) => load()

/** What decides a context, before the graph is read. */
export interface ContextDigestInputs {
  homeCountry: string | null
  entitled: readonly string[]
  sites: readonly SiteLeaf[]
  date: string
  packSeqs: Readonly<Record<string, number>>
  procedures: readonly ProcedureContext[]
  /** When the office's own records and the platform's checks last changed (`recordsStamp`); neither moves a pack sequence. */
  recordsStamp?: string
  /** The project's buildings, read by each edition's scope (ADR-0178): in the digest, so a changed answer re-resolves. */
  buildings?: BuildingScope
}

/** A stable hash of the inputs: same inputs, same digest, in any key order. */
export function contextDigest(inputs: ContextDigestInputs): string {
  const canonical = JSON.stringify({
    homeCountry: inputs.homeCountry,
    entitled: [...inputs.entitled].sort(),
    sites: inputs.sites,
    date: inputs.date,
    packSeqs: Object.fromEntries(Object.entries(inputs.packSeqs).sort(([a], [b]) => a.localeCompare(b))),
    procedures: inputs.procedures,
    recordsStamp: inputs.recordsStamp ?? null,
    buildings: inputs.buildings?.buildings ?? [],
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

/** The cache key of a resolved context: the organization and the project before the digest, always. */
export function contextCacheKey(organizationId: string, projectId: string | null, digest: string): string {
  return `knowledge-context-v3:${organizationId}:${projectId ?? '-'}:${digest}`
}

/**
 * The newest stable release sequence of each country's pack: what a running
 * research turn pins (E42) and what a confirmed Steckbrief records. The moves
 * are platform-private; only the numbers of countries the office is entitled
 * to leave this read.
 */
export async function packSequences(countries: readonly string[]): Promise<Record<string, number>> {
  if (countries.length === 0) return {}
  const rows = await withPlatformAccess('knowledge context: the newest stable release of each entitled pack', () =>
    getDb().execute<{ country_id: string; seq: string | number }>(sql`
      SELECT r.country_id, max(m.seq) AS seq
      FROM knowledge_release_moves m JOIN knowledge_records r ON r.id = m.record_id
      WHERE m.channel = 'stable' AND r.organization_id IS NULL AND r.country_id = ANY(${sqlTextArray([...countries])})
      GROUP BY r.country_id`),
  )
  return Object.fromEntries(rows.map((row) => [row.country_id, Number(row.seq)]))
}

/**
 * When the office's own records last gained a revision and the platform last
 * checked an edition: an office relation or a freshness check changes the
 * context without moving a pack sequence, so the digest reads them and the
 * next turn resolves again, rather than after the TTL.
 */
export async function recordsStamp(organizationId: string): Promise<string> {
  const rows = await withPlatformAccess('knowledge context: when the office records and the platform checks last changed', () =>
    getDb().execute<{ office: string | Date | null; checks: string | Date | null }>(sql`
      SELECT (SELECT max(v.created_at) FROM knowledge_revisions v WHERE v.organization_id = ${organizationId}) AS office,
        (SELECT max(k.checked_at) FROM knowledge_checks k WHERE k.organization_id IS NULL) AS checks`),
  )
  const row = rows[0]
  return [row?.office, row?.checks].map((value) => (value ? new Date(value).toISOString() : '-')).join('/')
}

function proceduresOf(facts: Readonly<Record<string, { value?: unknown } | undefined>>, leaves: readonly SiteLeaf[]): ProcedureContext[] {
  return PROCEDURE_IDS.filter((id) => profileHasProcedure(facts, id)).map((id) => {
    const procedure = procedureFromProfile(facts, id)
    return {
      id,
      procedureType: procedure.procedureType,
      filedOn: procedure.filedOn,
      decidedOn: procedure.decidedOn,
      // No reviewed reference-date rule is read here yet: "nicht bestimmt" (design §5.4), never a guess.
      referenceDates: Object.fromEntries(leaves.map((leaf) => [leaf.territoryId, { date: null, basis: 'undetermined' as const }])),
    }
  })
}

/** Resolve the context from what was read; the graph is read only for a site the office is entitled to. */
async function resolveFor(organizationId: string, inputs: ContextDigestInputs, time: PhaseTimer): Promise<KnowledgeContext> {
  const first = inputs.sites[0]
  const country = first ? countryOf(first.territoryId) : null
  const readsGraph = Boolean(inputs.homeCountry && first && country && inputs.entitled.includes(country))
  const loaded = readsGraph && first ? await time('knowledge-graph', () => loadGraph(organizationId, first.territoryId)) : null
  const graph = loaded?.graph ?? (readsGraph ? null : { territories: new Map(), works: new Map(), editions: new Map(), relations: [] })
  const context = resolveKnowledgeContext({
    homeCountry: inputs.homeCountry,
    entitled: new Set(inputs.entitled),
    sites: inputs.sites,
    graph,
    truncated: loaded?.truncated ?? false,
    date: inputs.date,
    now: new Date(),
    procedures: inputs.procedures,
    packSeqs: inputs.packSeqs,
    building: inputs.buildings ?? null,
  })
  // The sources a lookup may read follow what the turn may read: none where it reads no country's law.
  const { sources, dropped } = await time('knowledge-sources', () => lookupSourcesFor(context.retrieval.countries))
  return {
    ...context,
    ...(sources.length > 0 ? { sources } : {}),
    ...(dropped.length > 0 ? { sourcesDropped: dropped } : {}),
  }
}

/** The cached resolution for an office and project; throws what a read throws. */
async function resolution(organizationId: string, projectId: string | null, time: PhaseTimer): Promise<KnowledgeContext> {
  const inputs = await readContextInputs(organizationId, projectId)
  const key = contextCacheKey(organizationId, projectId, contextDigest(inputs))
  return getCached(key, CONTEXT_TTL_MS, () => resolveFor(organizationId, inputs, time))
}

/**
 * The context of a project as a person's page reads it (`projectLawFor`,
 * `project-base-get`): the same resolution the turn reads, from the same
 * cache. Fails closed like the turn: a read that throws is
 * `knowledge_unavailable`. Logged under its own marker, never the turn
 * alert's (ADR-0173): an intake polls every few seconds.
 */
export async function contextForPage(organizationId: string, projectId: string): Promise<KnowledgeContext> {
  try {
    return await resolution(organizationId, projectId, untimed)
  } catch (error) {
    console.error('[knowledge_context_page_read=false] the knowledge context could not be read for a page', { organizationId, projectId, error })
    return unavailableContext(calendarDayIn('UTC'))
  }
}

/** The context with nothing readable: retrieval, law lookup and classification withheld. */
export function unavailableContext(date: string): KnowledgeContext {
  return { gate: { state: 'knowledge_unavailable', reason: null, leaves: [] }, packs: [], chains: {}, date, procedures: [], uses: [], text: null, retrieval: { countries: [] } }
}

/** The inputs that decide a turn's context, read as the office. */
export async function readContextInputs(organizationId: string, projectId: string | null): Promise<ContextDigestInputs> {
  const [countries, profile, zone, stamp] = await Promise.all([
    readOrganizationCountries(organizationId),
    projectId ? findProjectProfileInOrg(projectId, organizationId) : Promise.resolve(null),
    officeTimeZone(organizationId),
    recordsStamp(organizationId),
  ])
  const entitled = countries.entitled.map((entry) => entry.countryId)
  const sites = siteLeaves(profile?.profile)
  const facts = profile?.profile?.facts ?? {}
  const date = calendarDayIn(zone)
  return {
    homeCountry: countries.homeCountry,
    entitled,
    sites,
    date,
    // `EU` follows any entitled member (ADR-0168), so its sequence is read too.
    packSeqs: await packSequences([...entitled, 'EU']),
    procedures: proceduresOf(facts, sites),
    recordsStamp: stamp,
    buildings: projectBuildings(profile?.profile, date),
  }
}

/**
 * Who reads a context: a chat turn; an operation (`project-base-get`, `-confirm`)
 * a person or an agent called; or a background run, which carries its own.
 */
export type ContextReader = 'turn' | 'operation' | 'run'

/**
 * The turn's knowledge context, always present: a read that fails gives
 * `knowledge_unavailable`, never no context, so the agent fails closed
 * (ADR-0175). Timed as the `knowledge` phase.
 * Only a turn's failed read counts toward the `knowledge_context_available`
 * alert: an operation's failure is its caller's error, already in its response.
 */
export async function knowledgeContextForTurn(
  organizationId: string,
  projectId: string | null,
  time: PhaseTimer = untimed,
  conversationId: string | null = null,
  reader: ContextReader = 'turn',
): Promise<KnowledgeContext> {
  return time('knowledge', async () => {
    try {
      const context = await resolution(organizationId, projectId, time)
      if (!conversationId) return context
      // What this turn is answered on: its answer records from it, not from a later resolution (E42).
      await rememberTurnContext(organizationId, conversationId, context)
      // After the cache: whether the base moved since this conversation's last answer is per conversation (E42).
      const previous = await lastAnswerPackSeqs(organizationId, conversationId)
      return { ...context, updatedSinceLastAnswer: packsUpdatedSince(context.packs, previous) }
    } catch (error) {
      // Only a chat turn's failure is the alert's: an operation's is in its own response, and logs its own marker.
      if (reader === 'turn') {
        unavailableTurns.add(1)
        console.error('[knowledge_context_available=false] the knowledge context could not be read', { organizationId, error })
      } else {
        console.error(`[knowledge_context_page_read=false] the knowledge context could not be read for ${reader === 'run' ? 'a background run' : 'an operation'}`, { organizationId, error })
      }
      return unavailableContext(calendarDayIn('UTC'))
    }
  })
}
