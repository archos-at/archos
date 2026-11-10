/**
 * Citation captures (ADR-0170): the page a platform record cites, as the
 * product fetched it or as an operator supplied it, kept with its sha256 and
 * text so KC-6 checks every quote against it. Insert-only; a capture goes into
 * a draft change request only (0208's trigger). Platform-private.
 */

import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { knowledgeCitationCaptures } from '@/lib/db/schema/knowledge-platform'
import type { Tx } from '../store/repository'
import type { KnownCapture } from './validate'
import type { CaptureView } from './wire'

type CaptureRow = typeof knowledgeCitationCaptures.$inferSelect

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The capture ids a batch cites. */
export const citedCaptureIds = (records: readonly { citations: readonly { captureId?: string }[] }[]): string[] =>
  records.flatMap((record) => record.citations.flatMap((citation) => (citation.captureId ? [citation.captureId] : [])))

export interface NewCapture {
  changeRequestId: string
  basis: 'fetched' | 'operator_supplied'
  sourceId: string | null
  url: string
  finalUrl: string | null
  contentType: string | null
  sha256: string
  bytes: number
  text: string | null
  note: string | null
  retrievedAt: Date
  createdBy: string
  viaClient: string | null
}

export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export function captureView(row: Omit<CaptureRow, 'text'> & { textChars: number }): CaptureView {
  return {
    captureId: row.id,
    changeRequestId: row.changeRequestId,
    basis: row.basis,
    sourceId: row.sourceId,
    url: row.url,
    finalUrl: row.finalUrl,
    contentType: row.contentType,
    sha256: row.sha256,
    bytes: row.byteSize,
    textChars: row.textChars,
    retrievedAt: new Date(row.retrievedAt).toISOString(),
  }
}

export async function insertCapture(tx: Tx, capture: NewCapture): Promise<CaptureView> {
  const [row] = await tx
    .insert(knowledgeCitationCaptures)
    .values({
      id: randomUUID(),
      changeRequestId: capture.changeRequestId,
      basis: capture.basis,
      sourceId: capture.sourceId,
      url: capture.url,
      finalUrl: capture.finalUrl,
      contentType: capture.contentType,
      sha256: capture.sha256,
      byteSize: capture.bytes,
      text: capture.text,
      note: capture.note,
      retrievedAt: capture.retrievedAt,
      createdBy: capture.createdBy,
      viaClient: capture.viaClient,
    })
    .returning()
  const stored = row as CaptureRow
  return captureView({ ...stored, textChars: stored.text?.length ?? 0 })
}

/** The captures of a request that `ids` name, by id, as KC-6 reads them; an id of no capture of it is absent. */
export async function capturesOf(tx: Tx, changeRequestId: string, ids: readonly string[]): Promise<Map<string, KnownCapture>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id))
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({ id: knowledgeCitationCaptures.id, text: knowledgeCitationCaptures.text, basis: knowledgeCitationCaptures.basis })
    .from(knowledgeCitationCaptures)
    .where(and(eq(knowledgeCitationCaptures.changeRequestId, changeRequestId), inArray(knowledgeCitationCaptures.id, wanted)))
  return new Map(rows.map((row) => [row.id, { text: row.text, basis: row.basis }]))
}

/** A request's captures as a reviewer reads them, without their text (only its length). */
export async function captureViews(tx: Tx, changeRequestId: string): Promise<CaptureView[]> {
  const { text: _text, ...columns } = getTableColumns(knowledgeCitationCaptures)
  const rows = await tx
    .select({ ...columns, textChars: sql<number>`coalesce(char_length(${knowledgeCitationCaptures.text}), 0)` })
    .from(knowledgeCitationCaptures)
    .where(eq(knowledgeCitationCaptures.changeRequestId, changeRequestId))
    .orderBy(knowledgeCitationCaptures.createdAt)
  return rows.map((row) => captureView({ ...row, textChars: Number(row.textChars) }))
}
