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
 * The bytes under a file name never change once a revision names it. A text
 * is kept as `<manifestationKey>-<12 hex of its sha256>.pdf`, so another text
 * is another file and nothing is replaced: not by an attach, not by a fetch,
 * not by the plain corpus upload. What a reviewer opens is served only while
 * its bytes are the ones the revision names (`readPlatformText`).
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
import { streamKnowledgeBaseDocumentAsPlatform } from '@/lib/knowledge/source-pdf'
import { CaptureFetchError, type ConfiguredSource, importSourceText } from './capture-fetch'
import { configuredSource, runKit } from './onboarding'
import { requirePlatform } from './service-gate'
import { type FetchedThrough, fetchedThrough, usableSource } from './sources'
import { insertProposedRecords, lockChangeRequest, platformTransaction } from './store'
import { checksOutsideKit } from './text-checks'
import { corpusName } from './upload-hashes'
import { draftManifestation, otherRecordNaming, pinsOfFiles, type TextPin, textPlacements } from './text-store'
import { type AttachTextResult, corpusFileNameSchema, type ImportTextBody, type ListTextsQuery, TEXT_PLACEMENT_PAGE, textFileName, type TextPlacementList } from './text-wire'
import { type ProposedRecord, proposedRecordSchema } from './wire'

type Manifestation = Extract<ProposedRecord, { type: 'manifestation' }>
type ProposedBy = NonNullable<KnowledgeProvenance['proposedBy']>

const recordIdOfKey = (key: string) => `manifestation:${key}`

const NAME_TAKEN_HINT =
  'The base corpus keeps other bytes under the name this text would take. Remove that file from the base corpus if no record names it, then attach again.'

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
): Promise<{ record: Manifestation; configured: ConfiguredSource | undefined; through: FetchedThrough }> {
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
    // Which of them it was is kept on the text: only a built-in or a reviewed released source counts as fetched.
    return { record: parsed.data, configured: source ? await configuredSource(tx, source) : undefined, through: fetchedThrough(source) }
  })
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
  // The corpus must hold exactly the bytes this revision names: the ones just stored, or already kept.
  const { checks } = await checksOutsideKit([next], new Map([[recordIdOfKey(record.key), { corpusFile: text.fileName, sha256: text.sha256 }]]))
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (request?.status !== 'draft') throw new ConflictError('The change request left draft while the text was stored.')
    // The fetch or the upload ran outside the lock. A proposal of this manifestation made meanwhile is not written
    // over with the snapshot taken before it: the attach is refused, and attaching again names the stored bytes.
    const latest = proposedRecordSchema.safeParse((await draftManifestation(tx, requestId, recordIdOfKey(record.key)))?.proposal)
    if (!latest.success || JSON.stringify(latest.data) !== JSON.stringify(record)) {
      throw new ConflictError('The manifestation was proposed again while its text was stored; nothing was named. Attach the text again.')
    }
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
  const { record, configured, through } = await manifestationInDraft(requestId, body.manifestationKey, body.sourceId)
  // Fetched outside any transaction: a slow source must not hold the request's lock. The api tier names the file
  // after the key and the bytes' hash, so a fetch that outlives the draft leaves a file no record names, not other
  // bytes under one that a record does.
  const imported = await importSourceText({ sourceId: body.sourceId, url: body.url, fileStem: body.manifestationKey }, configured).catch((error: unknown) => {
    throw error instanceof CaptureFetchError ? refusedText(error) : error
  })
  const fileName = imported.fileName
  if (fileName !== textFileName(body.manifestationKey, imported.sha256)) {
    throw new UpstreamError(`The fetched text was kept as ${fileName}, which is not the name of its bytes; nothing was named.`)
  }
  const text: KnowledgeTextProvenance = {
    origin: 'url',
    fileName,
    sha256: imported.sha256,
    bytes: imported.bytes,
    pages: imported.pages,
    sourceId: body.sourceId,
    sourceOrigin: through.sourceOrigin,
    ...(through.sourceRevisionId ? { sourceRevisionId: through.sourceRevisionId } : {}),
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
  if (!corpusFileNameSchema.safeParse(file.name).success) throw new UnprocessableError('A text is one PDF: upload a .pdf file whose name has no path.')
  const { record } = await manifestationInDraft(requestId, manifestationKey)
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length === 0) throw new UnprocessableError('The uploaded file is empty.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  // Named after the key and the bytes, whatever the upload was called: another text is another file.
  const fileName = textFileName(manifestationKey, sha256)
  const held = (await getKnowledgeBaseStatus()).files.find((entry) => entry.fileName === fileName && entry.state !== 'removed')
  if (held && held.currentSha256 !== sha256) {
    throw new ApiError(409, 'NAME_TAKEN', `The base corpus keeps other bytes as ${fileName}; nothing is replaced.`, { hint: NAME_TAKEN_HINT })
  }
  const stored = !held
  if (stored) {
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
 * The text of a manifestation of a change request, for whoever reads the request: the corpus's file, served only
 * when its bytes are the ones the revision names. The bytes that go out are hashed here, so what a reviewer reads
 * is what the revision pins, the kit checked and the publish indexes; anything else is a 409, never another text.
 */
export async function readPlatformText(session: UserSession | null, requestId: string, manifestationKey: string): Promise<Response> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const found = await platformTransaction((tx) => draftManifestation(tx, requestId, recordIdOfKey(manifestationKey)))
  if (!found?.text) throw new NotFoundError(`No manifestation ${manifestationKey} with a text in this change request.`)
  const { corpusFile, sha256 } = found.text
  const upstream = await streamKnowledgeBaseDocumentAsPlatform(corpusFile)
  const bytes = Buffer.from(await upstream.arrayBuffer())
  if (!sha256 || createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new ApiError(409, 'TEXT_CHANGED', `The base corpus keeps other bytes as ${corpusFile} than the ones this change request names; the text is not shown.`, {
      hint: 'Attach the text to this manifestation again in a draft change request; a request already submitted is rejected and proposed again.',
    })
  }
  return new Response(bytes, { status: 200, headers: upstream.headers })
}

/**
 * Refuse a plain corpus upload that would change the bytes under a file a revision names. Once any manifestation
 * revision names a file, released or not, its bytes never change: the upload passes only as a no-op (the bytes
 * the corpus keeps) or, for a file the corpus lost, as the bytes a revision names. `files` is what the upload
 * holds, by name: the one PDF, or the PDFs of a ZIP. A file no revision ever named passes.
 */
export async function refuseReplacingNamedTexts(files: ReadonlyMap<string, string>): Promise<void> {
  const pins = await platformTransaction((tx) => pinsOfFiles(tx, [...files.keys()]))
  if (pins.length === 0) return
  // A revision names one of them, so the corpus has to say what it keeps; no answer refuses the upload.
  const held = new Map((await getKnowledgeBaseStatus()).files.filter((file) => file.state !== 'removed').map((file) => [file.fileName, file.currentSha256]))
  const changes = (pin: TextPin & { recordId: string }) => {
    const sha256 = files.get(pin.corpusFile)
    if (held.has(pin.corpusFile)) return sha256 !== held.get(pin.corpusFile)
    return !pins.some((other) => other.corpusFile === pin.corpusFile && other.sha256 === sha256)
  }
  const swapped = pins.find(changes)
  if (swapped) {
    throw new ApiError(409, 'NAME_TAKEN', `${swapped.corpusFile} is the text of ${swapped.recordId}; the bytes under its name never change.`, {
      hint: 'Attach the new text to that manifestation in a draft change request with platform-knowledge-text-upload or platform-knowledge-text-import: it gets a file name of its own.',
    })
  }
}

/**
 * Refuse to remove a base-corpus file a record names, released or on its way
 * to a release: its publish, or its next re-index, would find no file.
 */
export async function refuseRemovingNamedText(fileName: string): Promise<void> {
  // As the caller removes it (trimmed), and as an upload would have stored it (NFC): a record that names either holds it.
  const names = [...new Set([fileName.trim(), corpusName(fileName)])]
  const recordId = await platformTransaction(async (tx) => {
    for (const name of names) {
      const naming = await otherRecordNaming(tx, name, null)
      if (naming) return naming
    }
    return null
  })
  if (recordId) {
    throw new ConflictError(
      `${fileName} is the text of ${recordId}; roll back or reject the change request that names it, or attach another text to that manifestation, before removing the file.`,
    )
  }
}
