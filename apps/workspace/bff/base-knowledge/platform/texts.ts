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

const REFUSAL_HINTS: Readonly<Record<string, string>> = {
  egress_refused: 'Use a URL on a host of the source, or upload the PDF with platform-knowledge-text-upload.',
  not_a_pdf: 'Give the URL of the PDF itself, not of the page that links to it.',
  name_taken: NAME_TAKEN_HINT,
}

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
    const source = sourceId ? await usableSource(tx, sourceId, requestId) : null
    return { record: parsed.data, configured: source ? await configuredSource(tx, source) : undefined, through: fetchedThrough(source) }
  })
}

async function nameTheText(
  session: { userId: string },
  requestId: string,
  record: Manifestation,
  text: KnowledgeTextProvenance,
  proposedBy: ProposedBy,
  stored: boolean,
): Promise<AttachTextResult> {
  const next: Manifestation = { ...record, corpusFile: text.fileName }
  const { checks } = await checksOutsideKit([next], new Map([[recordIdOfKey(record.key), { corpusFile: text.fileName, sha256: text.sha256 }]]))
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (request?.status !== 'draft') throw new ConflictError('The change request left draft while the text was stored.')
    const current = await draftManifestation(tx, requestId, recordIdOfKey(record.key))
    const latest = proposedRecordSchema.safeParse(current?.proposal)
    if (!latest.success || JSON.stringify(latest.data) !== JSON.stringify(record)) {
      throw new ConflictError('The manifestation was proposed again while its text was stored; nothing was named. Attach the text again.')
    }
    if (current?.releasedSha256 && current.releasedSha256 !== text.sha256) {
      throw new ApiError(409, 'TEXT_NOT_RELEASED', `The imported release has sha256 ${current.releasedSha256} for this text; these bytes have ${text.sha256}, so nothing was named.`, {
        hint: 'Attach the PDF whose sha256 the import answered for this manifestation, fetched from its URL or uploaded.',
      })
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
  return new ServiceUnavailableError(error.message)
}

export async function importPlatformText(
  session: UserSession | null,
  requestId: string,
  body: ImportTextBody,
  proposedBy: ProposedBy = 'person',
): Promise<AttachTextResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  return attachTextFromUrl(person.userId, requestId, body, proposedBy)
}

export async function attachTextFromUrl(attacher: string, requestId: string, body: ImportTextBody, proposedBy: ProposedBy): Promise<AttachTextResult> {
  const person = { userId: attacher }
  const { record, configured, through } = await manifestationInDraft(requestId, body.manifestationKey, body.sourceId)
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

export async function listPlatformTexts(session: UserSession | null, query: ListTextsQuery = {}): Promise<TextPlacementList> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const limit = query.limit ?? TEXT_PLACEMENT_PAGE
  const rows = await platformTransaction((tx) => textPlacements(tx, { countryId: query.countryId, after: query.cursor, limit: limit + 1 }))
  const texts = rows.slice(0, limit)
  return { texts, nextCursor: rows.length > limit ? (texts.at(-1)?.corpusFile ?? null) : null }
}

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

export async function refuseReplacingNamedTexts(files: ReadonlyMap<string, string>): Promise<void> {
  const pins = await platformTransaction((tx) => pinsOfFiles(tx, [...files.keys()]))
  if (pins.length === 0) return
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

export async function refuseRemovingNamedText(fileName: string): Promise<void> {
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
