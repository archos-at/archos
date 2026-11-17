import 'server-only'
import { sql } from 'drizzle-orm'
import type { KnowledgeProvenance } from '@/lib/db/schema/knowledge-records'
import type { ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import type { Tx } from '../store/repository'
import type { AttachedTextView, TextPlacementView } from './text-wire'

const OPEN_STATUSES = sql`('draft', 'submitted', 'approved')`

interface ManifestationRow extends Record<string, unknown> {
  revision_id: string
  record_id: string
  edition_id: string
  corpus_file: string | null
  sha256: string | null
  provenance: KnowledgeProvenance
  counts_as_fetched: boolean
}

async function newestManifestations(tx: Tx, requestId: string, recordId?: string): Promise<ManifestationRow[]> {
  return [
    ...(await tx.execute<ManifestationRow>(sql`
      SELECT DISTINCT ON (v.record_id) v.revision_id, v.record_id, m.edition_id, m.corpus_file, m.sha256, v.provenance,
        knowledge_text_counts_as_fetched(v.provenance, m.corpus_file, m.sha256, v.created_at) AS counts_as_fetched
      FROM knowledge_revisions v JOIN knowledge_manifestation_revisions m ON m.revision_id = v.revision_id
      WHERE v.change_request_id = ${requestId}::uuid AND v.organization_id IS NULL
        ${recordId ? sql`AND v.record_id = ${recordId}` : sql``}
      ORDER BY v.record_id, v.created_at DESC, v.revision_id DESC`)),
  ]
}

function textView(row: ManifestationRow & { corpus_file: string }): AttachedTextView {
  const text = row.provenance.text?.fileName === row.corpus_file ? row.provenance.text : undefined
  return {
    revisionId: row.revision_id,
    recordId: row.record_id,
    editionId: row.edition_id,
    corpusFile: row.corpus_file,
    origin: text?.origin ?? null,
    sha256: text?.sha256 ?? row.sha256,
    bytes: text?.bytes ?? null,
    pages: text?.pages ?? null,
    sourceId: text?.sourceId ?? null,
    sourceOrigin: text?.sourceOrigin ?? null,
    countsAsFetched: row.counts_as_fetched === true,
    url: text?.url ?? null,
    attachedBy: text?.attachedBy ?? null,
    attachedAt: text?.attachedAt ?? null,
  }
}

const named = (row: ManifestationRow): row is ManifestationRow & { corpus_file: string } => row.corpus_file !== null

export async function attachedTexts(tx: Tx, requestId: string): Promise<AttachedTextView[]> {
  return (await newestManifestations(tx, requestId)).filter(named).map(textView)
}

export async function draftManifestation(
  tx: Tx,
  requestId: string,
  recordId: string,
): Promise<{ proposal: unknown; text: AttachedTextView | null; releasedSha256: string | null } | null> {
  const [row] = await newestManifestations(tx, requestId, recordId)
  if (!row) return null
  return { proposal: row.provenance.proposal, text: named(row) ? textView(row) : null, releasedSha256: row.provenance.imported?.sha256 ?? null }
}

export interface TextPin {
  corpusFile: string
  sha256: string | null
}

export async function pinnedTexts(tx: Tx, requestId: string): Promise<Map<string, TextPin>> {
  return new Map((await newestManifestations(tx, requestId)).filter(named).map((row) => [row.record_id, { corpusFile: row.corpus_file, sha256: row.sha256 }]))
}

const NAMING = sql`
  FROM knowledge_manifestation_revisions m
  JOIN knowledge_records r ON r.id = m.record_id
  JOIN knowledge_revisions v ON v.revision_id = m.revision_id
  LEFT JOIN knowledge_change_requests c ON c.id = v.change_request_id
  WHERE m.organization_id IS NULL`

const RELEASED = sql`r.head_revision_id = m.revision_id`

const ON_ITS_WAY = sql`(c.status IN ${OPEN_STATUSES} AND NOT EXISTS (
  SELECT 1 FROM knowledge_revisions n
  WHERE n.record_id = v.record_id AND n.change_request_id = v.change_request_id
    AND (n.created_at, n.revision_id) > (v.created_at, v.revision_id)))`

export async function otherRecordNaming(tx: Tx, fileName: string, exceptRecordId: string | null): Promise<string | null> {
  const [row] = await tx.execute<{ record_id: string }>(sql`
    SELECT m.record_id ${NAMING} AND m.corpus_file = ${fileName}
      ${exceptRecordId ? sql`AND m.record_id <> ${exceptRecordId}` : sql``}
      AND (${RELEASED} OR ${ON_ITS_WAY})
    LIMIT 1`)
  return row?.record_id ?? null
}

export async function pinsOfFiles(tx: Tx, fileNames: readonly string[]): Promise<(TextPin & { recordId: string })[]> {
  if (fileNames.length === 0) return []
  const rows = await tx.execute<{ record_id: string; corpus_file: string; sha256: string | null }>(sql`
    SELECT DISTINCT m.record_id, m.corpus_file, m.sha256
    FROM knowledge_manifestation_revisions m
    WHERE m.organization_id IS NULL
      AND m.corpus_file IN (SELECT jsonb_array_elements_text(${JSON.stringify(fileNames)}::text::jsonb))
    LIMIT 5000`)
  return rows.map((row) => ({ recordId: row.record_id, corpusFile: row.corpus_file, sha256: row.sha256 }))
}

interface PlacementRow extends Record<string, unknown> {
  corpus_file: string
  country_id: string
  record_id: string
  edition_id: string
  edition_label: string | null
  work_title: string | null
  released: boolean
  change_request_id: string | null
  change_request_title: string | null
  change_request_status: ChangeRequestStatus | null
}

export async function textPlacements(tx: Tx, page: { countryId?: string; after?: string; limit: number }): Promise<TextPlacementView[]> {
  const rows = await tx.execute<PlacementRow>(sql`
    SELECT DISTINCT ON (m.corpus_file)
      m.corpus_file, r.country_id, m.record_id, m.edition_id, e.label AS edition_label, w.title AS work_title,
      (r.head_revision_id IS NOT DISTINCT FROM m.revision_id) AS released,
      v.change_request_id, c.title AS change_request_title, c.status AS change_request_status
    FROM knowledge_manifestation_revisions m
    JOIN knowledge_records r ON r.id = m.record_id
    JOIN knowledge_revisions v ON v.revision_id = m.revision_id
    LEFT JOIN knowledge_change_requests c ON c.id = v.change_request_id
    LEFT JOIN knowledge_records er ON er.id = m.edition_id
    LEFT JOIN LATERAL (
      SELECT b.label, b.work_id FROM knowledge_edition_revisions b JOIN knowledge_revisions bv ON bv.revision_id = b.revision_id
      WHERE b.record_id = m.edition_id
      ORDER BY (b.revision_id IS NOT DISTINCT FROM er.head_revision_id) DESC, bv.created_at DESC LIMIT 1) e ON true
    LEFT JOIN knowledge_records wr ON wr.id = e.work_id
    LEFT JOIN LATERAL (
      SELECT b.title FROM knowledge_work_revisions b JOIN knowledge_revisions bv ON bv.revision_id = b.revision_id
      WHERE b.record_id = e.work_id
      ORDER BY (b.revision_id IS NOT DISTINCT FROM wr.head_revision_id) DESC, bv.created_at DESC LIMIT 1) w ON true
    WHERE m.organization_id IS NULL AND m.corpus_file IS NOT NULL AND r.country_id IS NOT NULL
      ${page.countryId ? sql`AND r.country_id = ${page.countryId}` : sql``}
      ${page.after ? sql`AND m.corpus_file > ${page.after}` : sql``}
      AND (r.head_revision_id = m.revision_id OR NOT EXISTS (
        SELECT 1 FROM knowledge_revisions n
        WHERE n.record_id = v.record_id AND n.change_request_id = v.change_request_id
          AND (n.created_at, n.revision_id) > (v.created_at, v.revision_id)))
    ORDER BY m.corpus_file, (r.head_revision_id IS NOT DISTINCT FROM m.revision_id) DESC, v.created_at DESC
    LIMIT ${page.limit}`)
  return rows.map((row) => ({
    corpusFile: row.corpus_file,
    countryId: row.country_id,
    recordId: row.record_id,
    editionId: row.edition_id,
    editionLabel: row.edition_label,
    workTitle: row.work_title,
    released: row.released === true,
    changeRequestId: row.change_request_id,
    changeRequestTitle: row.change_request_title,
    changeRequestStatus: row.change_request_status,
  }))
}
