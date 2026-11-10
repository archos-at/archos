/**
 * Public sources as platform records (ADR-0174, design §4.1 and §4.2): which
 * configured source a fetch may use, and its key.
 *
 * **The host allowlist is read from the records, never kept beside them.**
 * - `active`: the source's released head. Its hosts are usable by every
 *   capture, test and monitor.
 * - `testing`: a source proposed in a change request that is still open
 *   (draft or submitted), for 24 hours from the revision, and only by that
 *   request's own test and capture. A draft cannot open a host for anyone else.
 * - Anything else is unknown, and a fetch with an unknown source is refused
 *   (fail closed). A source a repository file configures (`configs/sources/`)
 *   is not here; the api tier answers for it, as before this record type.
 *
 * **A credential is write-only.** It is stored through the BYOK secret store
 * (WorkOS Vault, or a local AES-GCM envelope bound to the platform organization
 * and the credential's id), one active per source, and only {@link revealedCredential}
 * reads it, for a fetch the api tier makes. Nothing returns it.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { knowledgeRecords, knowledgeRevisions } from '@/lib/db/schema/knowledge-records'
import { knowledgeChangeRequests } from '@/lib/db/schema/knowledge-platform'
import { knowledgeSourceCredentials, knowledgeSourceMonitorStates, knowledgeSourceRevisions } from '@/lib/db/schema/knowledge-sources'
import { revealSecret, storeSecret } from '@/lib/llm-credentials/secret-store'
import type { PersonDecisionSource } from '@/lib/base-knowledge/wire/vocab'
import type { Tx } from '../store/repository'

/** How long a draft source's hosts are usable by its own request (design §4.1). */
export const TESTING_WINDOW_MS = 24 * 60 * 60 * 1000

const OPEN_STATUSES = ['draft', 'submitted'] as const

export type SourceState = 'active' | 'testing'

export interface RegisteredSource {
  recordId: string
  key: string
  state: SourceState
  revisionId: string
  countryId: string
  /** The record as `public_sources.source.Source` reads it. */
  config: Record<string, unknown>
  hosts: string[]
  dataFlow: 'public_only' | 'site_keyed'
  monitorKind: 'none' | 'sha256' | 'etag' | 'version'
  monitorIntervalHours: number
  /** When the hosts stop being usable: the testing window's end, or null for an active source. */
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

/** The released source with this key, or null. */
export async function activeSource(tx: Tx, key: string): Promise<RegisteredSource | null> {
  const [row] = await tx
    .select({ body: knowledgeSourceRevisions, countryId: knowledgeRecords.countryId })
    .from(knowledgeRecords)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(and(eq(knowledgeRecords.id, sourceRecordId(key)), eq(knowledgeRecords.type, 'source'), isNull(knowledgeRecords.organizationId)))
  return row ? registered(row.body, 'active', row.countryId ?? '', null) : null
}

/** The newest revision of the source in an open request, while its testing window lasts; null otherwise. */
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

/**
 * The source a fetch for `requestId` may use: its own testing revision first
 * (the configuration under test), else the released one. Null for an unknown
 * key, a testing window that closed, or another request's draft.
 */
export async function usableSource(tx: Tx, key: string, requestId: string | null, now = new Date()): Promise<RegisteredSource | null> {
  const testing = requestId ? await testingSource(tx, key, requestId, now) : null
  return testing ?? (await activeSource(tx, key))
}

/** Every released source, for the monitor and the status. */
export async function activeSources(tx: Tx): Promise<RegisteredSource[]> {
  const rows = await tx
    .select({ body: knowledgeSourceRevisions, countryId: knowledgeRecords.countryId })
    .from(knowledgeRecords)
    .innerJoin(knowledgeSourceRevisions, eq(knowledgeSourceRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(and(eq(knowledgeRecords.type, 'source'), isNull(knowledgeRecords.organizationId), isNotNull(knowledgeRecords.headRevisionId)))
    .orderBy(knowledgeRecords.id)
  return rows.map((row) => registered(row.body, 'active', row.countryId ?? '', null))
}

/** Every source proposed in open requests, newest revision per record and request, with the request. */
export async function draftSources(tx: Tx, now = new Date()): Promise<(RegisteredSource & { changeRequestId: string })[]> {
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

/** The key of a source, for one fetch; null when none is set. Never logged, never returned. */
export async function revealedCredential(tx: Tx, recordId: string): Promise<string | null> {
  const [row] = await tx
    .select()
    .from(knowledgeSourceCredentials)
    .where(and(eq(knowledgeSourceCredentials.recordId, recordId), isNull(knowledgeSourceCredentials.replacedAt)))
  return row ? revealSecret({ ...row, organizationId: row.secretOwnerId }) : null
}

export interface CredentialView {
  set: boolean
  /** The last four characters, for a person to recognise the key by. */
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

/** Store a source's key (replacing the previous one); answers what may be shown of it. */
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
