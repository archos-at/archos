/**
 * The source monitor (ADR-0174, design §4.2): has a published public source
 * changed since its last check? Deterministic, no model call, and it never
 * publishes: a change opens a change request that a reviewer owns.
 *
 * A run (the `source-monitor` sweep, `bff/scheduling/tasks.ts`):
 * 1. Only with `source-monitors` on for the platform organization; otherwise it reads, fetches and writes nothing.
 * 2. Every published source whose monitor names a probe and whose interval has
 *    passed since its last check is probed through the api tier (the
 *    fetcher's guard: the source's hosts, public addresses, GET), with its key
 *    when one is set.
 * 3. The state is written either way: a failure keeps the last success, so
 *    the freshness lag grows.
 * 4. A change (the bytes, the validator or the version, by the monitor's kind)
 *    or changed terms opens a draft request, origin `monitor`, holding a
 *    capture of the new page and the finding: previous and current state,
 *    whether the terms moved, and what the reviewer needs to recheck. The
 *    state then moves to that page. While the request is open, a check moves
 *    only `checked_at` and `ok_at`: the state stays the page under review, so
 *    a change made meanwhile is still a change against it once the request
 *    closes, and opens the next one.
 * 5. One trace `source-monitor` with `freshness-lag-days` per watched source.
 *
 * An operator's agent finds the work with
 * `platform-knowledge-change-request-list {origin: monitor}`.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { isUniqueViolation } from '@/lib/db/errors'
import { knowledgeChangeRequests, knowledgeReleaseMoves } from '@/lib/db/schema/knowledge-platform'
import { recordSourceMonitorRun, type SourceMonitorRun } from '@/lib/langfuse/source-monitor-trace'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { CaptureFetchError } from './capture-fetch'
import { insertCapture } from './captures'
import { configuredSource } from './onboarding'
import { lagDays, type ProbeAnswer, probeSource } from './source-service'
import {
  activeSources,
  fetchedThrough,
  MONITOR_REQUEST_OPEN_STATUSES,
  type MonitorState,
  monitorStates,
  type RegisteredSource,
  touchMonitorState,
  writeMonitorState,
} from './sources'
import { platformTransaction } from './store'
import type { Tx } from '../store/repository'

/** Who a monitor's request and capture are created by: no person, the sweep. */
export const MONITOR_ACTOR = 'system:source-monitor'

/** At most this many sources are probed in one run; the rest are due next run. */
export const MAX_PROBES_PER_RUN = 50

/** What a reviewer of a monitor's request rechecks (`needs[]`), as codes. */
export type MonitorNeed = 'recheck_records' | 'name_transition' | 'recheck_terms'

export interface MonitorOutcome {
  enabled: boolean
  run: SourceMonitorRun | null
  /** The requests this run opened, by source record id. */
  opened: Record<string, string>
}

export interface MonitorDeps {
  probe: typeof probeSource
  enabled: () => Promise<boolean>
  record: (run: SourceMonitorRun) => Promise<void>
}

async function monitorsEnabled(): Promise<boolean> {
  const organizationId = await getPlatformOrganizationId()
  if (!organizationId) return false
  return isOrgFeatureEnabled(FEATURE_FLAGS.sourceMonitors, organizationId)
}

const DEFAULT_DEPS: MonitorDeps = { probe: probeSource, enabled: monitorsEnabled, record: recordSourceMonitorRun }

function watched(source: RegisteredSource): boolean {
  const monitor = source.config.monitor as { probe?: unknown } | undefined
  return source.monitorKind !== 'none' && Boolean(monitor?.probe)
}

function due(source: RegisteredSource, state: MonitorState | undefined, now: Date): boolean {
  return !state || state.checkedAt.getTime() + source.monitorIntervalHours * 3_600_000 <= now.getTime()
}

/** When a source was first published: its lag counts from there until a check succeeds. */
async function publishedAt(tx: Tx, recordId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ at: sql<string | null>`min(${knowledgeReleaseMoves.releasedAt})` })
    .from(knowledgeReleaseMoves)
    .where(sql`${knowledgeReleaseMoves.recordId} = ${recordId} AND ${knowledgeReleaseMoves.channel} = 'stable'`)
  return row?.at ? new Date(row.at) : null
}

function needsOf(source: RegisteredSource, previous: MonitorState | undefined, seen: ProbeAnswer): MonitorNeed[] {
  const needs: MonitorNeed[] = []
  if (seen.changed) needs.push('recheck_records')
  if (seen.changed && previous?.version && seen.current.version && previous.version !== seen.current.version) needs.push('name_transition')
  if (seen.termsChanged) needs.push('recheck_terms')
  return needs
}

/**
 * Open the monitor's request for a change, with the new page as its capture.
 * Null when one is already open for the source (the unique index decides, so
 * two runs at once cannot open two).
 */
async function openRequest(
  tx: Tx,
  source: RegisteredSource,
  previous: MonitorState | undefined,
  seen: ProbeAnswer,
  now: Date,
): Promise<string | null> {
  const id = randomUUID()
  const finding = {
    sourceKey: source.key,
    kind: source.monitorKind,
    url: seen.url,
    previous: { etag: previous?.etag ?? null, sha256: previous?.sha256 ?? null, version: previous?.version ?? null },
    current: { etag: seen.current.etag || null, sha256: seen.current.sha256 || null, version: seen.current.version || null },
    termsChanged: seen.termsChanged,
    anchors: seen.anchors.slice(0, 200),
    needs: needsOf(source, previous, seen),
  }
  const [newest] = await tx.select({ seq: sql<string | null>`max(${knowledgeReleaseMoves.seq})` }).from(knowledgeReleaseMoves)
  try {
    // A savepoint of its own: a refused insert must not abort the run's transaction.
    await tx.transaction(async (savepoint) => {
      await savepoint.insert(knowledgeChangeRequests).values({
        id,
        title: `Monitor: ${source.key} changed`,
        countryId: source.countryId,
        createdBy: MONITOR_ACTOR,
        baseReleaseSeq: Number(newest?.seq ?? 0),
        origin: 'monitor',
        sourceRecordId: source.recordId,
        monitorFinding: finding,
      })
    })
  } catch (error) {
    if (!isUniqueViolation(error, 'knowledge_change_requests_one_open_per_source')) throw error
    return null
  }
  // The new page, for the reviewer to read the change against (a 304 brought none back).
  if (/^[0-9a-f]{64}$/.test(seen.current.sha256)) {
    await insertCapture(tx, {
      changeRequestId: id,
      basis: 'fetched',
      sourceId: source.key,
      // The monitor reads released sources only.
      ...fetchedThrough(source),
      url: seen.url,
      finalUrl: seen.url,
      contentType: seen.contentType || null,
      sha256: seen.current.sha256,
      bytes: seen.bytes,
      text: seen.text,
      note: null,
      retrievedAt: now,
      createdBy: MONITOR_ACTOR,
      viaClient: null,
    })
  }
  return id
}

type Baseline = Pick<MonitorState, 'etag' | 'sha256' | 'version' | 'termsSha256'>

/** The page just seen, as the new state. */
function stateOf(seen: ProbeAnswer, state: MonitorState | undefined): Baseline {
  const hex = /^[0-9a-f]{64}$/
  return {
    etag: seen.current.etag || null,
    sha256: hex.test(seen.current.sha256) ? seen.current.sha256 : null,
    version: seen.current.version || null,
    termsSha256: hex.test(seen.current.termsSha256) ? seen.current.termsSha256 : (state?.termsSha256 ?? null),
  }
}

/** Whether a monitor's request for the source is still open: the page it holds is the one under review. */
async function hasOpenMonitorRequest(tx: Tx, recordId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: knowledgeChangeRequests.id })
    .from(knowledgeChangeRequests)
    .where(
      and(
        eq(knowledgeChangeRequests.origin, 'monitor'),
        eq(knowledgeChangeRequests.sourceRecordId, recordId),
        inArray(knowledgeChangeRequests.status, [...MONITOR_REQUEST_OPEN_STATUSES]),
      ),
    )
    .limit(1)
  return Boolean(row)
}

interface Checked {
  recordId: string
  lagSince: Date | null
  failed: boolean
  changed: boolean
  opened: string | null
}

async function checkOne(source: RegisteredSource, state: MonitorState | undefined, now: Date, deps: MonitorDeps): Promise<Checked> {
  const configured = await platformTransaction((tx) => configuredSource(tx, source))
  let seen: ProbeAnswer
  try {
    seen = await deps.probe(configured, state ?? {})
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    // The failure and the clock only: the baseline is the row's, whatever another run wrote since this one began.
    await platformTransaction((tx) =>
      touchMonitorState(tx, { recordId: source.recordId, checkedAt: now, okAt: state?.okAt ?? null, failure: error.message.slice(0, 500) }),
    )
    return { recordId: source.recordId, lagSince: state?.okAt ?? null, failed: true, changed: false, opened: null }
  }
  const changed = seen.changed || seen.termsChanged
  const opened = await platformTransaction(async (tx) => {
    const underReview = await hasOpenMonitorRequest(tx, source.recordId)
    const id = changed && !underReview ? await openRequest(tx, source, state, seen, now) : null
    // A change that opened no request (one is open, or another run opened it a moment ago) is not reviewed yet.
    const keep = underReview || (changed && id === null)
    const checked = { recordId: source.recordId, checkedAt: now, okAt: now, failure: null }
    // Kept: the row's own baseline stays, never this run's snapshot of it (an overlapping run may have moved it).
    await (keep ? touchMonitorState(tx, checked) : writeMonitorState(tx, { ...checked, ...stateOf(seen, state) }))
    return id
  })
  return { recordId: source.recordId, lagSince: now, failed: false, changed, opened }
}

/**
 * One source's check, whatever it throws: an error of this source (a record the
 * api tier refuses, a database refusal) is its failure, logged and counted, and
 * the run goes on to the next source.
 */
async function checkedOrFailed(source: RegisteredSource, state: MonitorState | undefined, now: Date, deps: MonitorDeps): Promise<Checked> {
  try {
    return await checkOne(source, state, now, deps)
  } catch (error) {
    console.error(`[source-monitor] ${source.recordId} failed:`, error)
    return { recordId: source.recordId, lagSince: state?.okAt ?? null, failed: true, changed: false, opened: null }
  }
}

/** One run of the monitor. `deps` stand in for the api tier, the flags and Langfuse in tests only. */
export async function runSourceMonitor(now = new Date(), stand: Partial<MonitorDeps> = {}): Promise<MonitorOutcome> {
  const deps: MonitorDeps = { ...DEFAULT_DEPS, ...stand }
  if (!(await deps.enabled())) return { enabled: false, run: null, opened: {} }
  const startedAt = Date.now()
  const { sources, states } = await platformTransaction(async (tx) => {
    const all = (await activeSources(tx)).filter(watched)
    return { sources: all, states: await monitorStates(tx, all.map((source) => source.recordId)) }
  })
  const results: Checked[] = []
  for (const source of sources.filter((candidate) => due(candidate, states.get(candidate.recordId), now)).slice(0, MAX_PROBES_PER_RUN)) {
    results.push(await checkedOrFailed(source, states.get(source.recordId), now, deps))
  }
  const checkedIds = new Set(results.map((result) => result.recordId))
  const lags = await platformTransaction(async (tx) =>
    Promise.all(
      sources.map(async (source) => {
        const result = results.find((candidate) => candidate.recordId === source.recordId)
        const since = checkedIds.has(source.recordId)
          ? (result?.lagSince ?? null)
          : (states.get(source.recordId)?.okAt ?? null)
        const from = since ?? (await publishedAt(tx, source.recordId)) ?? now
        return { recordId: source.recordId, days: lagDays(from, now) }
      }),
    ),
  )
  const run: SourceMonitorRun = {
    startedAt,
    endedAt: Date.now(),
    checked: results.length,
    changed: results.filter((result) => result.changed).length,
    failed: results.filter((result) => result.failed).length,
    opened: results.filter((result) => result.opened).length,
    lags,
  }
  await deps.record(run)
  const opened = Object.fromEntries(results.flatMap((result) => (result.opened ? [[result.recordId, result.opened]] : [])))
  return { enabled: true, run, opened }
}
