/**
 * A country's stable release, moved between deployments (rollover-to-prod, step 2): built and reviewed on one,
 * imported into another without re-running the onboarding there.
 *
 * - Export reads the head (the stable revision) of every platform record of the country, as the proposal it was
 *   published from, with the captures its citations name and each attached text's name, URL and sha256.
 * - Import writes that bundle into a NEW DRAFT change request, nothing more: no submit, no review, no approval,
 *   no publish. The importing deployment reviews it with four eyes as any request. Every capture comes in as
 *   `operator_supplied`: nobody fetched it there, so a person other than the importer checks it against its source
 *   before any approval (0209, 0224), as for a page an operator pasted. A text comes in as its name and sha256; the
 *   operator attaches the same bytes (`platform-knowledge-text-import` or `-text-upload`) before it validates.
 *
 * The bundle travels as a gzipped JSON file: a country's captured pages are megabytes, past what a tool result
 * shows as text, and a file goes through the door whole (up to its inline limit) and back as an upload.
 *
 * A record that names another country's record (a territory under a union, a relation into another pack) imports
 * only once that record is released on the importing deployment. The same bundle again changes nothing.
 */

import 'server-only'
import { gunzipSync, gzipSync } from 'node:zlib'
import { and, inArray, isNull, sql } from 'drizzle-orm'
import { ApiError, ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { sqlTextArray } from '@/lib/db/sql-list'
import { knowledgeRecords, type KnowledgeProvenance } from '@/lib/db/schema/knowledge-records'
import { knowledgeCitationCaptures } from '@/lib/db/schema/knowledge-platform'
import { citedCaptureIds, insertCapture, sha256Of } from './captures'
import { recordIdOf, referencesOf } from './records'
import { MAX_BUNDLE_RECORDS, RELEASE_BUNDLE_FORMAT, type ReleaseBundle, releaseBundleSchema, type ReleaseImportBody, type ReleaseImportResult } from './release-wire'
import { runKit } from './onboarding'
import { requirePlatform } from './service-gate'
import { canonicalJson, insertChangeRequestIn, insertProposedRecords, lockChangeRequest, platformTransaction } from './store'
import { checkedOutsideKit, namedTerritories } from './validate'
import { PROPOSED_RECORD_TYPES, type ProposedRecord, proposedRecordSchema } from './wire'

const typeOrder = (record: ProposedRecord) => PROPOSED_RECORD_TYPES.indexOf(record.type)

/** Every record id a record names: what must exist where it is imported. */
const namedIds = (record: ProposedRecord) => [...referencesOf(record).map((reference) => reference.id), ...namedTerritories(record)]

/** The bundle as the file the export answers: gzipped JSON, named after its country and release. */
export function releaseFile(bundle: ReleaseBundle): Response {
  return new Response(new Uint8Array(gzipSync(JSON.stringify(bundle))), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="knowledge-release-${bundle.countryId}-${bundle.releaseSeq}.json.gz"`,
    },
  })
}

/** The bundle a file holds, gzipped or not; refused whole when it is not one. */
export function bundleOf(bytes: Buffer): ReleaseBundle {
  let parsed: unknown
  try {
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }) : bytes
    parsed = JSON.parse(text.toString('utf8'))
  } catch {
    throw new UnprocessableError('The file is no release bundle: upload the file platform-knowledge-release-export answered, unchanged.')
  }
  const bundle = releaseBundleSchema.safeParse(parsed)
  if (!bundle.success) {
    const issues = bundle.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('/'), message: issue.message }))
    throw new UnprocessableError('The file is no release bundle this deployment reads; nothing was written.', { issues })
  }
  return bundle.data
}

/** The country's stable release as one bundle. Reads only. */
export async function exportCountryRelease(session: UserSession | null, countryId: string): Promise<ReleaseBundle> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeReview)
  return platformTransaction(async (tx) => {
    const heads = await tx.execute<{ id: string; provenance: KnowledgeProvenance; corpus_file: string | null; sha256: string | null; disputed: boolean }>(sql`
      SELECT r.id, v.provenance, m.corpus_file, m.sha256, c.second_review IS NOT DISTINCT FROM 'disputed' AS disputed
      FROM knowledge_records r
      JOIN knowledge_revisions v ON v.revision_id = r.head_revision_id
      LEFT JOIN knowledge_change_requests c ON c.id = v.change_request_id
      LEFT JOIN knowledge_manifestation_revisions m ON m.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND r.country_id = ${countryId}
      ORDER BY r.id LIMIT ${MAX_BUNDLE_RECORDS + 1}`)
    if (heads.length === 0) throw new NotFoundError(`${countryId} has no stable release on this deployment; publish it to stable first.`)
    if (heads.length > MAX_BUNDLE_RECORDS) throw new ConflictError(`${countryId} has more than ${MAX_BUNDLE_RECORDS} released records; one bundle carries fewer.`)
    const disputed = heads.find((head) => head.disputed)
    if (disputed) throw new ConflictError(`${disputed.id} was released by a request whose second review disputes it; settle that first (reject or roll it back).`)
    const records: ProposedRecord[] = []
    for (const head of heads) {
      const parsed = proposedRecordSchema.safeParse(head.provenance.proposal)
      // Unknown fails closed: a record released before the kit kept proposals cannot travel as one.
      if (!parsed.success) throw new ConflictError(`${head.id} was released without a readable proposal; propose and release it again first.`)
      records.push(parsed.data)
    }
    records.sort((a, b) => typeOrder(a) - typeOrder(b) || recordIdOf(a).localeCompare(recordIdOf(b)))
    const ids = records.map(recordIdOf)
    const outside = [...new Set(records.flatMap(namedIds))].filter((id) => !ids.includes(id)).sort()
    const cited = [...new Set(citedCaptureIds(records))]
    const [captures, requires, [newest]] = await Promise.all([
      cited.length === 0 ? [] : tx.select().from(knowledgeCitationCaptures).where(inArray(knowledgeCitationCaptures.id, cited)).orderBy(knowledgeCitationCaptures.id),
      outside.length === 0
        ? []
        : tx
            .select({ recordId: knowledgeRecords.id, countryId: knowledgeRecords.countryId })
            .from(knowledgeRecords)
            .where(and(inArray(knowledgeRecords.id, outside), isNull(knowledgeRecords.organizationId))),
      tx.execute<{ seq: string | null }>(sql`
        SELECT max(seq)::text AS seq FROM knowledge_release_moves WHERE channel = 'stable' AND record_id = ANY(${sqlTextArray(ids)})`),
    ])
    const files = new Map(heads.map((head) => [head.id, head]))
    return {
      format: RELEASE_BUNDLE_FORMAT,
      countryId,
      releaseSeq: Number(newest?.seq ?? 0),
      records,
      captures: captures.map((capture) => ({
        captureId: capture.id,
        basis: capture.basis,
        url: capture.url,
        finalUrl: capture.finalUrl,
        contentType: capture.contentType,
        sha256: capture.sha256,
        bytes: capture.byteSize,
        text: capture.text,
        retrievedAt: new Date(capture.retrievedAt).toISOString(),
      })),
      texts: records.flatMap((record) => {
        const head = files.get(recordIdOf(record))
        if (record.type !== 'manifestation' || !head?.corpus_file || !head.sha256) return []
        const text = head.provenance.text
        return [{ manifestationKey: record.key, fileName: head.corpus_file, sha256: head.sha256, url: text?.url ?? null, sourceId: text?.sourceId ?? null }]
      }),
      // Every record named outside the bundle; one no deployment holds says so with a null country.
      requires: outside.map((recordId) => ({ recordId, countryId: requires.find((row) => row.recordId === recordId)?.countryId ?? null })),
    }
  })
}

/** A record as the import proposes it: its citations on the imported captures, a source's recorded documents to be fetched again. */
function onImportedCaptures(record: ProposedRecord, captureIds: ReadonlyMap<string, string>): ProposedRecord {
  const citations = record.citations.map((citation) =>
    citation.captureId ? { ...citation, captureId: captureIds.get(citation.captureId) ?? citation.captureId } : citation,
  )
  if (record.type !== 'source') return { ...record, citations }
  // A fixture recorded from a capture needs a `fetched` capture through the source on this deployment (KC-7):
  // left open, so validate names it until the operator captures the document here.
  const fixtures = record.fixtures.map((fixture) => ({
    ...fixture,
    responses: Object.fromEntries(Object.entries(fixture.responses).map(([url, response]) => [url, 'captureId' in response ? { captureId: null } : response])),
  }))
  return { ...record, citations, fixtures }
}

const importNote = (basis: string, retrievedAt: string) =>
  `Imported from another deployment's release (${basis} there, ${retrievedAt}). Nobody fetched it here: check it against its source.`

/** Write a bundle into a new draft change request of its country. Never submits, approves or publishes. */
export async function importCountryRelease(
  session: UserSession | null,
  body: ReleaseImportBody,
  proposedBy: 'person' | 'agent' = 'person',
): Promise<ReleaseImportResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const { bundle } = body
  const digest = sha256Of(canonicalJson(bundle))
  const ids = new Set(bundle.records.map(recordIdOf))
  const outside = [...new Set(bundle.records.flatMap(namedIds))].filter((id) => !ids.has(id))
  const counts = { records: bundle.records.length, captures: bundle.captures.length, texts: bundle.texts }
  return platformTransaction(async (tx) => {
    // One import of a bundle at a time: the second waits, then finds the first.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`)
    const [prior] = await tx.execute<{ id: string; status: string }>(sql`
      SELECT c.id, c.status FROM knowledge_change_requests c
      WHERE c.country_id = ${bundle.countryId} AND c.status NOT IN ('rejected', 'rolled_back')
        AND EXISTS (SELECT 1 FROM knowledge_revisions v WHERE v.change_request_id = c.id AND v.provenance->'imported'->>'bundle' = ${digest})
      LIMIT 1`)
    if (prior) return { changeRequestId: prior.id, status: 'unchanged', requestStatus: prior.status, ...counts }
    const released = outside.length === 0 ? [] : await tx.execute<{ id: string }>(sql`
      SELECT id FROM knowledge_records WHERE organization_id IS NULL AND head_revision_id IS NOT NULL AND id = ANY(${sqlTextArray(outside)})`)
    const missing = outside.filter((id) => !released.some((row) => row.id === id)).sort()
    if (missing.length > 0) {
      const countries = [...new Set(bundle.requires.filter((row) => missing.includes(row.recordId)).flatMap((row) => (row.countryId ? [row.countryId] : [])))]
      throw new ApiError(422, 'REFERENCE_NOT_RELEASED', `The release names ${missing.join(', ')}, which this deployment has not released to stable; nothing was written.`, {
        missing,
        hint: `Import, review and publish ${countries.length > 0 ? countries.join(', ') : 'the country that holds them'} on this deployment first, then import this bundle again.`,
      })
    }
    const requestId = await insertChangeRequestIn(tx, {
      title: body.title ?? `Import of ${bundle.countryId} release ${bundle.releaseSeq}`,
      countryId: bundle.countryId,
      createdBy: person.userId,
    })
    const captureIds = new Map<string, string>()
    for (const capture of bundle.captures) {
      const stored = await insertCapture(tx, {
        changeRequestId: requestId,
        basis: 'operator_supplied',
        sourceId: null,
        sourceOrigin: null,
        sourceRevisionId: null,
        url: capture.url,
        finalUrl: capture.finalUrl,
        contentType: capture.contentType,
        sha256: capture.sha256,
        bytes: capture.bytes,
        text: capture.text,
        note: importNote(capture.basis, capture.retrievedAt),
        retrievedAt: new Date(capture.retrievedAt),
        createdBy: person.userId,
        viaClient: null,
      })
      captureIds.set(capture.captureId, stored.captureId)
    }
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new ConflictError('The draft was not created; import again.')
    const records = bundle.records.map((record) => onImportedCaptures(record, captureIds))
    // The kit as a proposal runs it, before anything is kept: a bundle that fails here leaves no draft behind. A
    // text's bytes and a source's fixtures are the api tier's to check; validate runs them once they are attached.
    const later = new Map(records.filter(checkedOutsideKit).map((record) => [recordIdOf(record), []]))
    const problems = await runKit(tx, request, records, later)
    if (problems.length > 0) {
      throw new UnprocessableError(`The release fails ${problems.length} check(s) here; nothing was written.`, { problems: problems.slice(0, 50) })
    }
    // Each manifestation names the released file and its sha256: validate holds the attached bytes to it (KC-1).
    const pins = new Map(bundle.texts.map((text) => [`manifestation:${text.manifestationKey}`, text.sha256]))
    await insertProposedRecords(tx, request, records, { createdBy: person.userId, proposedBy, pins, imported: { bundle: digest } })
    return { changeRequestId: requestId, status: 'created', requestStatus: 'draft', ...counts }
  })
}
