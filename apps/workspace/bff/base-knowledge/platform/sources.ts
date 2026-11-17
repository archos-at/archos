import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { type FetchSourceOrigin, knowledgeRecords, knowledgeRevisions } from '@/lib/db/schema/knowledge-records'
import { knowledgeChangeRequests } from '@/lib/db/schema/knowledge-platform'
import { knowledgeSourceCredentials, knowledgeSourceMonitorStates, knowledgeSourceRevisions } from '@/lib/db/schema/knowledge-sources'
import { revealSecret, storeSecret } from '@/lib/llm-credentials/secret-store'
import type { PersonDecisionSource } from '@/lib/base-knowledge/wire/vocab'
import type { Tx } from '../store/repository'

export const TESTING_WINDOW_MS = 24 * 60 * 60 * 1000

const OPEN_STATUSES = ['draft', 'submitted'] as const

export const MONITOR_REQUEST_OPEN_STATUSES = ['draft', 'submitted', 'approved'] as const

export type SourceState = 'active' | 'testing'

export interface RegisteredSource {
  recordId: string
  key: string
  state: SourceState
  revisionId: string
  countryId: string
  config: Record<string, unknown>
  hosts: string[]
  dataFlow: 'public_only' | 'site_keyed'
  monitorKind: 'none' | 'sha256' | 'etag' | 'version'
  monitorIntervalHours: number
  usableUntil: Date | null
}

export const sourceRecordId = (key: string) => `source:${key}`
export const sourceKeyOf = (recordId: string) => recordId.replace(/^source:/, '')

type BodyRow = typeof knowledgeSourceRevisions.$inferSelect

function registered(body: BodyRow, state: SourceState, countryId: string, usableUntil: Date | null): RegisteredSource {
  return {
    recordId: body.recordId,
    key: sourceKeyOf(body.recordId),
    state,
    revisionId: body.revisionId,
    countryId,
    config: body.config,
    hosts: body.hosts,
    dataFlow: body.dataFlow,
    monitorKind: body.monitorKind,
    monitorIntervalHours: body.monitorIntervalHours,
    usableUntil,
  }
}

export async function activeSource(tx: Tx, key: string): Promise<RegisteredSource | null> {
  const [row] = await tx
    .select({ body: knowledgeSourceRevisions, countryId: knowledgeRecords.countryId })
    .from(knowledgeRecords)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(and(eq(knowledgeRecords.id, sourceRecordId(key)), eq(knowledgeRecords.type, 'source'), isNull(knowledgeRecords.organizationId)))
  return row ? registered(row.body, 'active', row.countryId ?? '', null) : null
}

export async function testingSource(tx: Tx, key: string, requestId: string, now = new Date()): Promise<RegisteredSource | null> {
  const [row] = await tx
    .select({ body: knowledgeSourceRevisions, createdAt: knowledgeRevisions.createdAt, countryId: knowledgeChangeRequests.countryId })
    .from(knowledgeRevisions)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRevisions.revisionId))
    .innerJoin(knowledgeChangeRequests, eq(knowledgeChangeRequests.id, knowledgeRevisions.changeRequestId))
    .where(
      and(
        eq(knowledgeRevisions.recordId, sourceRecordId(key)),
        eq(knowledgeRevisions.changeRequestId, requestId),
        inArray(knowledgeChangeRequests.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(desc(knowledgeRevisions.createdAt), desc(knowledgeRevisions.revisionId))
    .limit(1)
  if (!row) return null
  const until = new Date(row.createdAt.getTime() + TESTING_WINDOW_MS)
  return until > now ? registered(row.body, 'testing', row.countryId, until) : null
}

export async function usableSource(tx: Tx, key: string, requestId: string | null, now = new Date()): Promise<RegisteredSource | null> {
  const testing = requestId ? await testingSource(tx, key, requestId, now) : null
  return testing ?? (await activeSource(tx, key))
}

export interface FetchedThrough {
  sourceOrigin: FetchSourceOrigin
  sourceRevisionId: string | null
}

export function fetchedThrough(source: RegisteredSource | null): FetchedThrough {
  if (!source) return { sourceOrigin: 'built_in', sourceRevisionId: null }
  return { sourceOrigin: source.state === 'active' ? 'released' : 'draft', sourceRevisionId: source.revisionId }
}

export async function activeSources(tx: Tx): Promise<RegisteredSource[]> {
  const rows = await tx
    .select({ body: knowledgeSourceRevisions, countryId: knowledgeRecords.countryId })
    .from(knowledgeRecords)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(and(eq(knowledgeRecords.type, 'source'), isNull(knowledgeRecords.organizationId), isNotNull(knowledgeRecords.headRevisionId)))
    .orderBy(knowledgeRecords.id)
  return rows.map((row) => registered(row.body, 'active', row.countryId ?? '', null))
}

export async function draftSources(tx: Tx): Promise<(RegisteredSource & { changeRequestId: string })[]> {
  const rows = await tx
    .select({
      body: knowledgeSourceRevisions,
      createdAt: knowledgeRevisions.createdAt,
      changeRequestId: knowledgeChangeRequests.id,
      countryId: knowledgeChangeRequests.countryId,
    })
    .from(knowledgeRevisions)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRevisions.revisionId))
    .innerJoin(knowledgeChangeRequests, eq(knowledgeChangeRequests.id, knowledgeRevisions.changeRequestId))
    .where(inArray(knowledgeChangeRequests.status, [...OPEN_STATUSES]))
    .orderBy(knowledgeRevisions.createdAt, knowledgeRevisions.revisionId)
  const newest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) newest.set(`${row.changeRequestId}|${row.body.recordId}`, row)
  return [...newest.values()].map((row) => {
    const until = new Date(row.createdAt.getTime() + TESTING_WINDOW_MS)
    return { ...registered(row.body, 'testing', row.countryId, until), changeRequestId: row.changeRequestId }
  })
}

export async function revealedCredential(tx: Tx, recordId: string): Promise<string | null> {
  const [row] = await tx
    .select()
    .from(knowledgeSourceCredentials)
    .where(and(eq(knowledgeSourceCredentials.recordId, recordId), isNull(knowledgeSourceCredentials.replacedAt)))
  return row ? revealSecret({ ...row, organizationId: row.secretOwnerId }) : null
}

export interface CredentialView {
  set: boolean
  hint: string | null
  setAt: string | null
}

export async function credentialView(tx: Tx, recordId: string): Promise<CredentialView> {
  const [row] = await tx
    .select({ keyHint: knowledgeSourceCredentials.keyHint, setAt: knowledgeSourceCredentials.setAt })
    .from(knowledgeSourceCredentials)
    .where(and(eq(knowledgeSourceCredentials.recordId, recordId), isNull(knowledgeSourceCredentials.replacedAt)))
  return row ? { set: true, hint: row.keyHint, setAt: row.setAt.toISOString() } : { set: false, hint: null, setAt: null }
}

export async function storeSourceCredential(
  tx: Tx,
  input: { recordId: string; organizationId: string; secret: string; setBy: string; decisionSource: PersonDecisionSource },
): Promise<CredentialView> {
  const id = randomUUID()
  const stored = await storeSecret(input.organizationId, id, input.secret)
  const keyHint = `…${input.secret.slice(-4)}`
  await tx
    .update(knowledgeSourceCredentials)
    .set({ replacedAt: new Date() })
    .where(and(eq(knowledgeSourceCredentials.recordId, input.recordId), isNull(knowledgeSourceCredentials.replacedAt)))
  const [row] = await tx
    .insert(knowledgeSourceCredentials)
    .values({
      id,
      recordId: input.recordId,
      secretOwnerId: input.organizationId,
      secretBackend: stored.secretBackend,
      vaultObjectId: stored.vaultObjectId,
      encryptedKey: stored.encryptedKey,
      keyHint,
      setBy: input.setBy,
      decisionSource: input.decisionSource,
    })
    .returning({ setAt: knowledgeSourceCredentials.setAt })
  return { set: true, hint: keyHint, setAt: (row?.setAt ?? new Date()).toISOString() }
}

export type MonitorState = typeof knowledgeSourceMonitorStates.$inferSelect

export async function monitorStates(tx: Tx, recordIds: readonly string[]): Promise<Map<string, MonitorState>> {
  if (recordIds.length === 0) return new Map()
  const rows = await tx.select().from(knowledgeSourceMonitorStates).where(inArray(knowledgeSourceMonitorStates.recordId, [...recordIds]))
  return new Map(rows.map((row) => [row.recordId, row]))
}

export async function writeMonitorState(tx: Tx, state: MonitorState): Promise<void> {
  await tx
    .insert(knowledgeSourceMonitorStates)
    .values(state)
    .onConflictDoUpdate({ target: knowledgeSourceMonitorStates.recordId, set: { ...state } })
}

export async function touchMonitorState(
  tx: Tx,
  state: Pick<MonitorState, 'recordId' | 'checkedAt' | 'okAt' | 'failure'>,
): Promise<void> {
  const clock = { checkedAt: state.checkedAt, okAt: state.okAt, failure: state.failure }
  await tx
    .insert(knowledgeSourceMonitorStates)
    .values({ ...state, etag: null, sha256: null, version: null, termsSha256: null })
    .onConflictDoUpdate({ target: knowledgeSourceMonitorStates.recordId, set: clock })
}
