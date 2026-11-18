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
import { readSetupRecords } from '@/lib/project-intake/setup-records'
import { assumedSubdivisionOf, subdivisionTerritories } from '@/lib/project-intake/setup-scope'
import { projectBuildings } from '../chain/building'
import type { BuildingScope } from '../rulesets/applicability'
import { loadGraph } from '../chain/load'
import { readOrganizationCountries } from '../platform/entitlements'
import { PROFILE_PROCEDURE_IDS, procedureFromProfile, profileHasProcedure } from '../time/profile-procedure'
import { countryOf, resolveKnowledgeContext, type SiteLeaf } from './resolve'
import { lastAnswerPackSeqs, packsUpdatedSince } from './last-answer'
import { rememberTurnContext } from './turn-snapshot'
import { siteLeaves } from './site'
import { lookupSourcesFor } from './sources'
import type { KnowledgeContext, ProcedureContext } from './wire'

type ReferenceDate = ProcedureContext['referenceDates'][string]

export const CONTEXT_TTL_MS = 10 * 60 * 1000

const PROCEDURE_IDS = PROFILE_PROCEDURE_IDS

const unavailableTurns = metrics
  .getMeter('base-knowledge')
  .createCounter('knowledge_context.unavailable', { description: 'Turns whose knowledge context could not be read' })

export type PhaseTimer = <T>(name: string, load: () => Promise<T>) => Promise<T>

const untimed: PhaseTimer = (_name, load) => load()

export interface ContextDigestInputs {
  homeCountry: string | null
  entitled: readonly string[]
  sites: readonly SiteLeaf[]
  date: string
  packSeqs: Readonly<Record<string, number>>
  procedures: readonly ProcedureContext[]
  recordsStamp?: string
  buildings?: BuildingScope
  asOf?: string
}

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
    ...(inputs.asOf ? { asOf: inputs.asOf } : {}),
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

export function contextCacheKey(organizationId: string, projectId: string | null, digest: string): string {
  return `knowledge-context-v6:${organizationId}:${projectId ?? '-'}:${digest}`
}

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

export async function recordsStamp(organizationId: string): Promise<string> {
  const rows = await withPlatformAccess('knowledge context: when the office records and the platform checks last changed', () =>
    getDb().execute<{ office: string | Date | null; checks: string | Date | null }>(sql`
      SELECT (SELECT max(v.created_at) FROM knowledge_revisions v WHERE v.organization_id = ${organizationId}) AS office,
        (SELECT max(k.checked_at) FROM knowledge_checks k WHERE k.organization_id IS NULL) AS checks`),
  )
  const row = rows[0]
  return [row?.office, row?.checks].map((value) => (value ? new Date(value).toISOString() : '-')).join('/')
}

export function referenceDateOf(filedOn: string | null, today: string): ReferenceDate {
  return filedOn && filedOn <= today ? { date: filedOn, basis: 'filed_on' } : { date: null, basis: 'undetermined' }
}

function proceduresOf(facts: Readonly<Record<string, { value?: unknown } | undefined>>, leaves: readonly SiteLeaf[], today: string): ProcedureContext[] {
  return PROCEDURE_IDS.filter((id) => profileHasProcedure(facts, id)).map((id) => {
    const procedure = procedureFromProfile(facts, id)
    return {
      id,
      procedureType: procedure.procedureType,
      filedOn: procedure.filedOn,
      decidedOn: procedure.decidedOn,
      referenceDates: Object.fromEntries(leaves.map((leaf) => [leaf.territoryId, referenceDateOf(procedure.filedOn, today)])),
    }
  })
}

async function resolveFor(organizationId: string, inputs: ContextDigestInputs, time: PhaseTimer): Promise<KnowledgeContext> {
  const first = inputs.sites[0]
  const country = first ? countryOf(first.territoryId) : null
  const readsGraph = Boolean(inputs.homeCountry && first && country && inputs.entitled.includes(country))
  const loaded = readsGraph && first ? await time('knowledge-graph', () => loadGraph(organizationId, first.territoryId)) : null
  const graph = loaded?.graph ?? (readsGraph ? null : { territories: new Map(), works: new Map(), editions: new Map(), relations: [] })
  const reference = first ? inputs.procedures[0]?.referenceDates[first.territoryId] : undefined
  const context = resolveKnowledgeContext({
    homeCountry: inputs.homeCountry,
    entitled: new Set(inputs.entitled),
    sites: inputs.sites,
    graph,
    truncated: loaded?.truncated ?? false,
    date: inputs.asOf ?? reference?.date ?? inputs.date,
    dateBasis: inputs.asOf ? undefined : reference?.basis,
    now: new Date(),
    procedures: inputs.procedures,
    packSeqs: inputs.packSeqs,
    building: inputs.buildings ?? null,
  })
  const { sources, dropped } = await time('knowledge-sources', () => lookupSourcesFor(context.retrieval.countries))
  return {
    ...context,
    ...(sources.length > 0 ? { sources } : {}),
    ...(dropped.length > 0 ? { sourcesDropped: dropped } : {}),
  }
}

async function resolution(organizationId: string, projectId: string | null, time: PhaseTimer, asOf?: string): Promise<KnowledgeContext> {
  const read = await readContextInputs(organizationId, projectId)
  const inputs = asOf ? { ...read, asOf } : read
  const key = contextCacheKey(organizationId, projectId, contextDigest(inputs))
  return getCached(key, CONTEXT_TTL_MS, () => resolveFor(organizationId, inputs, time))
}

export async function contextForPage(organizationId: string, projectId: string, asOf?: string): Promise<KnowledgeContext> {
  try {
    return await resolution(organizationId, projectId, untimed, asOf)
  } catch (error) {
    console.error('[knowledge_context_page_read=false] the knowledge context could not be read for a page', { organizationId, projectId, error })
    return unavailableContext(calendarDayIn('UTC'))
  }
}

export function unavailableContext(date: string): KnowledgeContext {
  return { gate: { state: 'knowledge_unavailable', reason: null, leaves: [] }, packs: [], chains: {}, date, procedures: [], uses: [], text: null, retrieval: { countries: [] } }
}

export async function readContextInputs(organizationId: string, projectId: string | null): Promise<ContextDigestInputs> {
  const [countries, profile, zone, stamp, setupRecords] = await Promise.all([
    readOrganizationCountries(organizationId),
    projectId ? findProjectProfileInOrg(projectId, organizationId) : Promise.resolve(null),
    officeTimeZone(organizationId),
    recordsStamp(organizationId),
    readSetupRecords(organizationId),
  ])
  const entitled = countries.entitled.map((entry) => entry.countryId)
  const officeAssumed = assumedSubdivisionOf(setupRecords, countries.homeCountry)?.territoryId ?? null
  const sites = siteLeaves(profile?.profile, subdivisionTerritories(setupRecords), officeAssumed)
  const facts = profile?.profile?.facts ?? {}
  const date = calendarDayIn(zone)
  return {
    homeCountry: countries.homeCountry,
    entitled,
    sites,
    date,
    packSeqs: await packSequences([...entitled, 'EU']),
    procedures: proceduresOf(facts, sites, date),
    recordsStamp: stamp,
    buildings: projectBuildings(profile?.profile, date, setupRecords),
  }
}

export interface StatedSite {
  territoryId: string | null
  filedOn: string | null
}

export async function knowledgeContextForStatedSite(organizationId: string, stated: StatedSite): Promise<KnowledgeContext> {
  try {
    const inputs = await readContextInputs(organizationId, null)
    const sites: SiteLeaf[] = stated.territoryId ? [{ territoryId: stated.territoryId, certainty: 'verified' }] : []
    const procedures: ProcedureContext[] = stated.filedOn
      ? [
          {
            id: PROCEDURE_IDS[0],
            procedureType: null,
            filedOn: stated.filedOn,
            decidedOn: null,
            referenceDates: Object.fromEntries(sites.map((leaf) => [leaf.territoryId, referenceDateOf(stated.filedOn, inputs.date)])),
          },
        ]
      : []
    return await resolveFor(organizationId, { ...inputs, sites, procedures }, untimed)
  } catch (error) {
    console.error('[knowledge_context_page_read=false] the knowledge context could not be read for a stated site', { organizationId, error })
    return unavailableContext(calendarDayIn('UTC'))
  }
}

export type ContextReader = 'turn' | 'operation' | 'run'

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
      await rememberTurnContext(organizationId, conversationId, context)
      const previous = await lastAnswerPackSeqs(organizationId, conversationId)
      return { ...context, updatedSinceLastAnswer: packsUpdatedSince(context.packs, previous) }
    } catch (error) {
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
