/**
 * Platform texts (ADR-0165, "Texts are attached in the request"): the file an
 * edition's manifestation points to is added inside the draft change request
 * that proposes it, from an upload or from a URL on a configured public
 * source. Attaching stores the bytes in the base corpus, where nobody reads
 * them until a release marks them with the request's country (ADR-0173), and
 * re-proposes the manifestation with that file as its `corpusFile`. So the
 * reviewer sees the text beside the edition, and the publish finds the file.
 *
 * A URL is fetched and read by the public-source fetcher (ADR-0162): this tier
 * asks the api tier (`importSourceText`) and never sees the bytes. An upload
 * goes through the corpus's own upload. One file is one record's text: a name
 * another record uses is never replaced or removed under it.
 *
 * Writes take `platform:knowledge:write`, the read `platform:settings:view`.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { ApiError, ConflictError, NotFoundError, ServiceUnavailableError, UnprocessableError, UpstreamError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingClientId } from '@/lib/agent-api/acting-session'
import type { KnowledgeProvenance, KnowledgeTextProvenance } from '@/lib/db/schema/knowledge-records'
import { getKnowledgeBaseStatus, uploadKnowledgeBaseDocument } from '@/lib/knowledge/service'
import { CaptureFetchError, type ConfiguredSource, importSourceText } from './capture-fetch'
import { configuredSource, runKit } from './onboarding'
import { requirePlatform } from './service-gate'
import { usableSource } from './sources'
import { insertProposedRecords, lockChangeRequest, platformTransaction } from './store'
import { checksOutsideKit } from './text-checks'
import { draftManifestation, otherRecordNaming, textPlacements } from './text-store'
import { type AttachTextResult, corpusFileNameSchema, type ImportTextBody, type ListTextsQuery, TEXT_PLACEMENT_PAGE, type TextPlacementList } from './text-wire'
import { type ProposedRecord, proposedRecordSchema } from './wire'

type Manifestation = Extract<ProposedRecord, { type: 'manifestation' }>
type ProposedBy = NonNullable<KnowledgeProvenance['proposedBy']>

const recordIdOfKey = (key: string) => `manifestation:${key}`

const NAME_TAKEN_HINT = 'Give the file another name (fileName for a URL, the upload’s own name), one no other record uses.'

/** What an agent does about each named refusal of a fetched text. */
const REFUSAL_HINTS: Readonly<Record<string, string>> = {
  egress_refused: 'Use a URL on a host of the source, or upload the PDF with platform-knowledge-text-upload.',
  not_a_pdf: 'Give the URL of the PDF itself, not of the page that links to it.',
  name_taken: NAME_TAKEN_HINT,
}

/** The draft's manifestation an attach is for, and (for a URL) the source its fetch may use. */
async function manifestationInDraft(
  requestId: string,
  manifestationKey: string,
  sourceId?: string,
): Promise<{ record: Manifestation; configured: ConfiguredSource | undefined }> {
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'draft') throw new ConflictError(`The change request is ${request.status}; a text is attached in a draft.`)
    const found = await draftManifestation(tx, requestId, recordIdOfKey(manifestationKey))
    const parsed = proposedRecordSchema.safeParse(found?.proposal)
    if (!parsed.success || parsed.data.type !== 'manifestation') {
      throw new NotFoundError(
        `No manifestation ${manifestationKey} in this draft; propose it first with platform-knowledge-records-propose (corpusFile null), then attach its text.`,
      )
    }
    // A configured source (ADR-0174): its testing revision in this request, else its released one, as for a capture.
    const source = sourceId ? await usableSource(tx, sourceId, requestId) : null
    return { record: parsed.data, configured: source ? await configuredSource(tx, source) : undefined }
  })
}

/** Whether `fileName` is free for this record: no other record, released or on its way, names it. */
async function nameIsOwn(fileName: string, manifestationKey: string): Promise<boolean> {
  return (await platformTransaction((tx) => otherRecordNaming(tx, fileName, recordIdOfKey(manifestationKey)))) === null
}

/** Re-propose the manifestation with the stored file as its text; the kit runs on it as on any proposal. */
async function nameTheText(
  session: UserSession,
  requestId: string,
  record: Manifestation,
  text: KnowledgeTextProvenance,
  proposedBy: ProposedBy,
  stored: boolean,
): Promise<AttachTextResult> {
  const next: Manifestation = { ...record, corpusFile: text.fileName }
  const checks = await checksOutsideKit([next])
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (request?.status !== 'draft') throw new ConflictError('The change request left draft while the text was stored.')
    const problems = await runKit(tx, request, [next], checks)
    if (problems.length > 0) {
      throw new UnprocessableError(`The manifestation fails ${problems.length} check(s) with this text; nothing was written.`, { problems })
    }
    const viaClient = actingClientId()
    const [written] = await insertProposedRecords(tx, request, [next], {
      createdBy: session.userId,
      proposedBy,
      text,
      ...(viaClient ? { viaClient } : {}),
    })
    const view = (await draftManifestation(tx, requestId, recordIdOfKey(record.key)))?.text
    if (!written || !view) throw new ConflictError('The manifestation was not written; try again.')
    return { text: view, status: written.status, stored }
  })
}

/** The file name a fetched text is kept under when none is given: the URL's own, else the manifestation's key. */
function defaultFileName(url: string, manifestationKey: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  const named = corpusFileNameSchema.safeParse(last)
  return named.success ? named.data : `${manifestationKey}.pdf`
}

function refusedText(error: CaptureFetchError): ApiError {
  if (error.code) {
    const hint = REFUSAL_HINTS[error.code] ?? 'Find another copy of the document, or upload the PDF with platform-knowledge-text-upload.'
    return new ApiError(error.status === 409 ? 409 : 422, error.code.toUpperCase(), error.message, { hint })
  }
  if (error.status === 404) return new NotFoundError(error.message)
  if (error.status === 403) return new UnprocessableError(error.message, { hint: REFUSAL_HINTS.egress_refused })
  // Nothing was stored; the caller retries, or uploads the PDF.
  return new ServiceUnavailableError(error.message)
}

/** Attach the PDF at a URL of a configured source to a manifestation of a draft request. */
export async function importPlatformText(
  session: UserSession | null,
  requestId: string,
  body: ImportTextBody,
  proposedBy: ProposedBy = 'person',
): Promise<AttachTextResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const { record, configured } = await manifestationInDraft(requestId, body.manifestationKey, body.sourceId)
  const fileName = body.fileName ?? defaultFileName(body.url, body.manifestationKey)
  const replace = await nameIsOwn(fileName, body.manifestationKey)
  // Fetched outside any transaction: a slow source must not hold the request's lock.
  const imported = await importSourceText({ sourceId: body.sourceId, url: body.url, fileName, replace }, configured).catch((error: unknown) => {
    throw error instanceof CaptureFetchError ? refusedText(error) : error
  })
  const text: KnowledgeTextProvenance = {
    origin: 'url',
    fileName,
    sha256: imported.sha256,
    bytes: imported.bytes,
    pages: imported.pages,
    sourceId: body.sourceId,
    url: imported.finalUrl,
    attachedBy: person.userId,
    attachedAt: imported.retrievedAt,
  }
  return nameTheText(person, requestId, record, text, proposedBy, imported.stored)
}

/** Attach an uploaded PDF to a manifestation of a draft request. */
export async function uploadPlatformText(
  session: UserSession | null,
  requestId: string,
  manifestationKey: string,
  file: File,
  proposedBy: ProposedBy = 'person',
): Promise<AttachTextResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const named = corpusFileNameSchema.safeParse(file.name)
  if (!named.success) throw new UnprocessableError('A text is one PDF: upload a .pdf file whose name has no path.')
  const fileName = named.data
  const { record } = await manifestationInDraft(requestId, manifestationKey)
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length === 0) throw new UnprocessableError('The uploaded file is empty.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const held = (await getKnowledgeBaseStatus()).files.find((entry) => entry.fileName === fileName && entry.state !== 'removed')
  const stored = held?.currentSha256 !== sha256
  if (stored) {
    if (held && !(await nameIsOwn(fileName, manifestationKey))) {
      throw new ApiError(409, 'NAME_TAKEN', `The base corpus keeps a different file as ${fileName}, and another record names it.`, { hint: NAME_TAKEN_HINT })
    }
    const result = await uploadKnowledgeBaseDocument(new File([bytes], fileName, { type: 'application/pdf' }))
    if (result.status !== 'pending' && result.status !== 'success') throw new UpstreamError(`The base corpus did not take ${fileName}: ${result.message}`)
  }
  const text: KnowledgeTextProvenance = { origin: 'upload', fileName, sha256, bytes: bytes.length, pages: null, attachedBy: person.userId, attachedAt: new Date().toISOString() }
  return nameTheText(person, requestId, record, text, proposedBy, stored)
}

/** Where each base-corpus file belongs: its country, edition and change request. */
export async function listPlatformTexts(session: UserSession | null, query: ListTextsQuery = {}): Promise<TextPlacementList> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const limit = query.limit ?? TEXT_PLACEMENT_PAGE
  // One more than the page says whether another follows.
  const rows = await platformTransaction((tx) => textPlacements(tx, { countryId: query.countryId, after: query.cursor, limit: limit + 1 }))
  const texts = rows.slice(0, limit)
  return { texts, nextCursor: rows.length > limit ? (texts.at(-1)?.corpusFile ?? null) : null }
}

/**
 * Refuse to remove a base-corpus file a record names, released or on its way
 * to a release: its publish, or its next re-index, would find no file.
 */
export async function refuseRemovingNamedText(fileName: string): Promise<void> {
  const recordId = await platformTransaction((tx) => otherRecordNaming(tx, fileName, null))
  if (recordId) {
    throw new ConflictError(
      `${fileName} is the text of ${recordId}; roll back or reject the change request that names it, or attach another text to that manifestation, before removing the file.`,
    )
  }
}
