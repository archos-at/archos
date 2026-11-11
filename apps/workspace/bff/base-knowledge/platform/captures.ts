/**
 * Citation captures (ADR-0170): the page a platform record cites, as the
 * product fetched it or as an operator supplied it, kept with its sha256 and
 * text so KC-6 checks every quote against it. Insert-only; a capture goes into
 * a draft change request only (0209's trigger). Platform-private.
 */

import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { knowledgeCitationCaptures } from '@/lib/db/schema/knowledge-platform'
import type { FetchSourceOrigin } from '@/lib/db/schema/knowledge-records'
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
  /** What a fetch went through (`fetchedThrough`); both null for an operator's text. */
  sourceOrigin: FetchSourceOrigin | null
  sourceRevisionId: string | null
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

/** A PDF capture's text joins its pages with a form feed (`public_sources.pdf`): the page of a quote is the form feeds before it, plus one. */
export const PAGE_BREAK = '\f'

export const isPdf = (contentType: string | null) => (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf'

/** A PDF capture's pages, counted from its text; null for any other capture, or a PDF that kept no text. */
export function pagesOf(contentType: string | null, text: string | null): number | null {
  return isPdf(contentType) && text !== null ? text.split(PAGE_BREAK).length : null
}

/** Whether the capture counts as fetched (migration 0224), asked of the database: the one place that decides. */
const COUNTS_AS_FETCHED = sql<boolean>`knowledge_capture_counts_as_fetched(${knowledgeCitationCaptures.basis}, ${knowledgeCitationCaptures.sourceId}, ${knowledgeCitationCaptures.sourceOrigin}, ${knowledgeCitationCaptures.sourceRevisionId}, ${knowledgeCitationCaptures.createdAt})`

export function captureView(row: Omit<CaptureRow, 'text'> & { textChars: number; pages: number | null; countsAsFetched: boolean }): CaptureView {
  return {
    captureId: row.id,
    changeRequestId: row.changeRequestId,
    basis: row.basis,
    sourceId: row.sourceId,
    sourceOrigin: row.sourceOrigin,
    countsAsFetched: row.countsAsFetched === true,
    url: row.url,
    finalUrl: row.finalUrl,
    contentType: row.contentType,
    sha256: row.sha256,
    bytes: row.byteSize,
    textChars: row.textChars,
    pages: row.pages,
    note: row.note,
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
      sourceOrigin: capture.sourceOrigin,
      sourceRevisionId: capture.sourceRevisionId,
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
  const [counted] = await tx.select({ countsAsFetched: COUNTS_AS_FETCHED }).from(knowledgeCitationCaptures).where(eq(knowledgeCitationCaptures.id, stored.id))
  return captureView({
    ...stored,
    textChars: stored.text?.length ?? 0,
    pages: pagesOf(stored.contentType, stored.text),
    countsAsFetched: counted?.countsAsFetched === true,
  })
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

/** A capture as a source fixture's recording reads it (`source-checks.ts`): what it is of, how it was taken, and its text. */
/** The phrase the reader's note carries when the text cap stopped a PDF's read (`PdfText.note`, pinned by test_pdf.py). */
const CUT_NOTE = 'read only in part'
/** Whether a capture's note says its text is a prefix of the document. */
export const isCut = (note: string | null) => (note ?? '').includes(CUT_NOTE)

export interface RecordingCapture {
  id: string
  basis: 'fetched' | 'operator_supplied'
  sourceId: string | null
  url: string
  contentType: string | null
  text: string | null
  note: string | null
}

/**
 * The captures `ids` name, for a source's fixtures. `changeRequestId` holds them to that request (a proposal names
 * captures of its own request); null reads them wherever they are, for a stored source whose request validated them.
 */
export async function recordingCapturesOf(tx: Tx, changeRequestId: string | null, ids: readonly string[]): Promise<Map<string, RecordingCapture>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id))
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({
      id: knowledgeCitationCaptures.id,
      basis: knowledgeCitationCaptures.basis,
      sourceId: knowledgeCitationCaptures.sourceId,
      url: knowledgeCitationCaptures.url,
      contentType: knowledgeCitationCaptures.contentType,
      text: knowledgeCitationCaptures.text,
      note: knowledgeCitationCaptures.note,
    })
    .from(knowledgeCitationCaptures)
    .where(
      and(inArray(knowledgeCitationCaptures.id, wanted), ...(changeRequestId ? [eq(knowledgeCitationCaptures.changeRequestId, changeRequestId)] : [])),
    )
  return new Map(rows.map((row) => [row.id.toLowerCase(), row]))
}

/** A request's captures as a reviewer reads them, without their text (only its length). */
export async function captureViews(tx: Tx, changeRequestId: string): Promise<CaptureView[]> {
  const { text: _text, ...columns } = getTableColumns(knowledgeCitationCaptures)
  const rows = await tx
    .select({
      ...columns,
      countsAsFetched: COUNTS_AS_FETCHED,
      textChars: sql<number>`coalesce(char_length(${knowledgeCitationCaptures.text}), 0)`,
      // Form feeds plus one, as pagesOf counts them; chr(12) is the form feed.
      pageBreaks: sql<number | null>`char_length(${knowledgeCitationCaptures.text}) - char_length(replace(${knowledgeCitationCaptures.text}, chr(12), ''))`,
    })
    .from(knowledgeCitationCaptures)
    .where(eq(knowledgeCitationCaptures.changeRequestId, changeRequestId))
    .orderBy(knowledgeCitationCaptures.createdAt)
  return rows.map(({ pageBreaks, ...row }) =>
    captureView({
      ...row,
      textChars: Number(row.textChars),
      pages: isPdf(row.contentType) && pageBreaks !== null ? Number(pageBreaks) + 1 : null,
    }),
  )
}
