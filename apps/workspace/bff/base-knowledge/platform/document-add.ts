/**
 * Add one document to a country in one call (Platform → a country → "Add a
 * document"): the steps of the onboarding guide for one PDF, in order, so a
 * person in the browser and an agent on the platform door do the same thing.
 *
 * 1. The country's open draft change request, or a new one titled for the document.
 * 2. A capture the records cite (KC-6): the PDF itself, fetched through the source
 *    whose host the URL is on; or, for an upload, the title lines the person
 *    copied from it (operator-supplied: this tier reads no PDF, so the reviewer
 *    checks them against the file). A capture of the same URL in the draft is reused.
 * 3. The work (when new), the edition and its manifestation, each quoting the
 *    capture where it prints the work's designation or title and the edition's label.
 * 4. The text: fetched again by `importPlatformText`, which must be the bytes the
 *    capture hashed, or the uploaded bytes.
 *
 * Every step is an existing service call with its own checks; this module only
 * orders them and words what goes wrong. A text step that fails after the records
 * were proposed leaves them in the draft and says so: the same call again reuses
 * the capture and the records and only attaches the text.
 */

import 'server-only'
import { and, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm'
import { ApiError, NotFoundError, PayloadTooLargeError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { MAX_UPLOAD_BYTES } from '@/lib/agent-api/upload-wire'
import { knowledgeEditionRevisions, knowledgeRecords, knowledgeWorkRevisions } from '@/lib/db/schema/knowledge-records'
import type { Tx } from '../store/repository'
import { captureViews, capturesOf, isPdf, sha256Of } from './captures'
import {
  type AddDocumentBody,
  type AddDocumentResult,
  type CountryWorkView,
  keyPart,
  type ListWorksQuery,
  quoteNaming,
  type UploadDocumentFields,
} from './document-add-wire'
import { capturePlatformCitation } from './onboarding'
import { createPlatformChangeRequest, proposePlatformRecords } from './service'
import { requirePlatform } from './service-gate'
import { platformSourceStatus } from './source-service'
import { listChangeRequests, platformTransaction } from './store'
import { draftManifestation } from './text-store'
import { importPlatformText, uploadPlatformText } from './texts'
import { type CaptureBody, type CaptureView, type ProposedRecord, proposedRecordSchema } from './wire'

type ProposedBy = 'person' | 'agent'
type DocumentInput = Pick<AddDocumentBody, 'work' | 'label' | 'inForceFrom'> & { licenceClass?: AddDocumentBody['licenceClass'] }
type Cited = { captureId: string; url: string; sha256: string; text: string | null }

/** Released works of a country that `where` picks, by key, each with its released editions' labels. */
async function worksWith(tx: Tx, countryId: string, where: SQL | undefined, limit: number): Promise<CountryWorkView[]> {
  const works = await tx
    .select({
      id: knowledgeRecords.id,
      title: knowledgeWorkRevisions.title,
      kind: knowledgeWorkRevisions.kind,
      identifiers: knowledgeWorkRevisions.identifiers,
    })
    .from(knowledgeRecords)
    .innerJoin(knowledgeWorkRevisions, eq(knowledgeWorkRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(and(isNull(knowledgeRecords.organizationId), eq(knowledgeRecords.type, 'work'), eq(knowledgeRecords.countryId, countryId), where))
    .orderBy(knowledgeRecords.id)
    .limit(limit)
  const editions = works.length
    ? await tx
        .select({ id: knowledgeRecords.id, workId: knowledgeEditionRevisions.workId, label: knowledgeEditionRevisions.label })
        .from(knowledgeRecords)
        .innerJoin(knowledgeEditionRevisions, eq(knowledgeEditionRevisions.revisionId, knowledgeRecords.headRevisionId))
        .where(
          and(
            isNull(knowledgeRecords.organizationId),
            inArray(
              knowledgeEditionRevisions.workId,
              works.map((work) => work.id)
            )
          )
        )
        .limit(5000)
    : []
  return works.map((work) => ({
    workKey: work.id.replace(/^work:/, ''),
    title: work.title,
    designation: (work.identifiers as { designation?: string }).designation ?? null,
    kind: work.kind,
    editions: editions
      .filter((edition) => edition.workId === work.id)
      .map((edition) => ({ editionKey: edition.id.replace(/^edition:/, ''), label: edition.label })),
  }))
}

/** The released works of a country by key, a page at a time, with their released editions' labels. */
export async function listCountryWorks(session: UserSession | null, countryId: string, page: ListWorksQuery = { limit: 200 }) {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const works = await platformTransaction((tx) =>
    worksWith(tx, countryId, page.cursor ? gt(knowledgeRecords.id, `work:${page.cursor}`) : undefined, page.limit + 1)
  )
  const more = works.length > page.limit
  works.splice(page.limit)
  return { works, nextCursor: more ? (works.at(-1)?.workKey ?? null) : null }
}

/** The work the document belongs to, as the records name it: looked up by its key, existing or new. */
async function resolveWork(countryId: string, work: DocumentInput['work']) {
  const key = 'workKey' in work ? work.workKey : `${countryId.toLowerCase()}-${keyPart(work.designation ?? work.title)}`
  const [known] = await platformTransaction((tx) => worksWith(tx, countryId, eq(knowledgeRecords.id, `work:${key}`), 1))
  if ('workKey' in work) {
    if (!known) throw new NotFoundError(`No released work ${key} in ${countryId}; list them with platform-knowledge-work-list, or name a new work.`)
    return { key, named: known.designation ?? known.title, editions: known.editions, record: null }
  }
  const record = known ? null : { type: 'work', key, kind: work.kind, title: work.title, designation: work.designation, territoryIds: [countryId] }
  return { key, named: work.designation ?? work.title, editions: known?.editions ?? [], record }
}

/** The country's newest open operator draft (a monitor's is not one), or a new one titled for the document. */
async function draftFor(session: UserSession, countryId: string, title: string): Promise<{ id: string; title: string; opened: boolean }> {
  const [open] = await listChangeRequests({ status: 'draft', countryId, origin: 'operator' }, { offset: 0, limit: 1 })
  if (open) return { id: open.id, title: open.title, opened: false }
  return { ...(await createPlatformChangeRequest(session, { title, countryId })), title, opened: true }
}

/** The source of this country whose hosts the URL is on. */
async function sourceForUrl(session: UserSession, countryId: string, url: string): Promise<string> {
  const host = new URL(url).hostname.toLowerCase()
  const { sources } = await platformSourceStatus(session, {})
  const source = sources.find(
    (one) => one.countryId === countryId && one.state === 'active' && one.hosts.some((entry) => entry.host === host && entry.state === 'active')
  )
  if (!source) {
    throw new ApiError(422, 'HOST_NOT_ON_SOURCE', `${host} is on no source of ${countryId}; nothing was written.`, {
      hint: 'Use the URL of the PDF at a host this country’s sources list (Sources tab), or upload the file and say where it is published.',
    })
  }
  return source.sourceKey
}

/** Steps 1 to 3: the draft, the capture, the records; what step 4 attaches the text to. A retry reuses what is in the draft. */
async function proposeDocument(session: UserSession, countryId: string, input: DocumentInput, body: CaptureBody, proposedBy: ProposedBy) {
  const work = await resolveWork(countryId, input.work)
  const editionKey = `${work.key}-${keyPart(input.label, 30)}`
  const manifestationKey = `${editionKey}-text`
  if (work.editions.some((edition) => edition.editionKey === editionKey || normalized(edition.label) === normalized(input.label))) {
    throw new ApiError(409, 'EDITION_EXISTS', `${work.named} already has the edition ${input.label}; nothing was written.`, {
      hint: 'Pick the edition’s own label as the document prints it, or open the edition on this page to replace its text in a change request.',
    })
  }
  const draft = await draftFor(session, countryId, `${work.named} ${input.label}`)
  const held = await platformTransaction((tx) => draftManifestation(tx, draft.id, `manifestation:${manifestationKey}`))
  if (held?.text) {
    throw new ApiError(409, 'EDITION_EXISTS', `The draft "${draft.title}" already holds ${work.named} ${input.label} with a text; nothing was written.`, {
      hint: 'Review that change request, or reject it before adding the edition again.',
    })
  }
  const cited = (await capturedBefore(draft.id, body)) ?? (await captureWithText(session, draft.id, body))
  // Proposed by an earlier call whose text step failed: the records stand, only the text is missing.
  if (!held) {
    const cite = (label: string) => [{ captureId: cited.captureId, quote: quoteOf(cited.text, label), url: cited.url }]
    // Parsed, so every field the document does not say takes the schema's default.
    const records: ProposedRecord[] = [
      ...(work.record ? [{ ...work.record, citations: cite(work.named) }] : []),
      { type: 'edition', key: editionKey, workKey: work.key, label: input.label, inForceFrom: input.inForceFrom, citations: cite(input.label) },
      { type: 'manifestation', key: manifestationKey, editionKey, licenceClass: input.licenceClass ?? 'public_open', citations: cite(input.label) },
    ].map((record) => proposedRecordSchema.parse(record))
    await proposePlatformRecords(session, draft.id, { records, dryRun: false }, proposedBy)
  }
  return { draft, cited, keys: { workKey: work.key, editionKey, manifestationKey } }
}

const normalized = (label: string) => label.trim().toLowerCase()

function quoteOf(text: string | null, label: string): string {
  const found = text ? quoteNaming(text, label) : null
  if (found) return found
  throw new ApiError(422, 'NOT_PRINTED', `The document does not print "${label}"; nothing was proposed.`, {
    hint: 'Write the work’s designation or title and the edition’s label exactly as the document prints them.',
  })
}

/** A capture of the same page already in the draft (an earlier call's), so a retry neither fetches nor stores it again. */
async function capturedBefore(requestId: string, body: CaptureBody): Promise<Cited | null> {
  const same = (view: CaptureView) =>
    view.basis === body.basis &&
    view.url === body.url &&
    (body.basis === 'fetched' ? view.sourceId === body.sourceId && isPdf(view.contentType) : view.sha256 === sha256Of(body.text))
  return platformTransaction(async (tx) => {
    const view = (await captureViews(tx, requestId)).findLast(same)
    if (!view) return null
    const text = (await capturesOf(tx, requestId, [view.captureId])).get(view.captureId)?.text ?? null
    return { captureId: view.captureId, url: view.finalUrl ?? view.url, sha256: view.sha256, text }
  })
}

async function captureWithText(session: UserSession, requestId: string, body: CaptureBody): Promise<Cited> {
  const view = await capturePlatformCitation(session, requestId, body)
  if (body.basis === 'fetched' && !isPdf(view.contentType)) {
    throw new ApiError(422, 'NOT_A_PDF', `${body.url} answers ${view.contentType ?? 'no content type'}, not a PDF; nothing was proposed.`, {
      hint: 'Give the URL of the PDF itself, not of the page that links to it.',
    })
  }
  const text = (await platformTransaction((tx) => capturesOf(tx, requestId, [view.captureId]))).get(view.captureId)?.text ?? null
  return { captureId: view.captureId, url: view.finalUrl ?? view.url, sha256: view.sha256, text }
}

/** Step 4, worded so a failure says where the records are and that the same call finishes it. */
async function attachText(done: Proposed, attach: () => Promise<{ text: { sha256: string | null } }>): Promise<string> {
  const where = {
    changeRequestId: done.draft.id,
    hint: `The records are in the draft "${done.draft.title}" (${done.draft.id}); call again to attach the text.`,
  }
  let sha256: string | null
  try {
    sha256 = (await attach()).text.sha256
  } catch (error) {
    if (!(error instanceof ApiError))
      throw new ApiError(502, 'TEXT_NOT_ATTACHED', `The text was not attached: ${error instanceof Error ? error.message : 'unknown failure'}.`, where)
    throw new ApiError(error.status, error.code, `${error.message} ${where.hint}`, { ...(error.details as object | undefined), ...where })
  }
  return sha256 ?? ''
}

type Proposed = Awaited<ReturnType<typeof proposeDocument>>

/** Add the PDF at its publisher's URL: fetched by the platform through the country's source for that host. */
export async function addPlatformDocument(
  session: UserSession | null,
  countryId: string,
  body: AddDocumentBody,
  proposedBy: ProposedBy = 'person'
): Promise<AddDocumentResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const sourceId = await sourceForUrl(person, countryId, body.url)
  const done = await proposeDocument(person, countryId, body, { basis: 'fetched', sourceId, url: body.url }, proposedBy)
  const sha256 = await attachText(done, () =>
    importPlatformText(person, done.draft.id, { manifestationKey: done.keys.manifestationKey, sourceId, url: body.url }, proposedBy)
  )
  if (sha256 !== done.cited.sha256) {
    throw new ApiError(
      409,
      'TEXT_CHANGED',
      `${body.url} answered other bytes for the text than for the capture the records quote; the draft "${done.draft.title}" holds both.`,
      {
        changeRequestId: done.draft.id,
        hint: 'The publisher changed the file meanwhile: reject that draft, or capture the PDF again in it and propose the records anew.',
      }
    )
  }
  return result(done, sha256)
}

/** Add an uploaded PDF: its records quote the title lines the person copied, which the reviewer checks against the file. */
export async function uploadPlatformDocument(
  session: UserSession | null,
  countryId: string,
  fields: UploadDocumentFields,
  file: File,
  proposedBy: ProposedBy = 'person'
): Promise<AddDocumentResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeError(MAX_UPLOAD_BYTES)
  const head = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString('latin1')
  if (head !== '%PDF-') throw new UnprocessableError(`${file.name} is not a PDF; nothing was written.`, { hint: 'Upload the document as a PDF.' })
  const capture: CaptureBody = { basis: 'operator_supplied', url: fields.publishedAt, text: fields.titleText, note: 'Title lines copied from an uploaded PDF.' }
  const done = await proposeDocument(person, countryId, fields, capture, proposedBy)
  // Named after the manifestation, whatever the upload was called (`uploadPlatformText`).
  const pdf = new File([file], `${done.keys.manifestationKey}.pdf`, { type: 'application/pdf' })
  return result(done, await attachText(done, () => uploadPlatformText(person, done.draft.id, done.keys.manifestationKey, pdf, proposedBy)))
}

function result(done: Proposed, sha256: string): AddDocumentResult {
  return { changeRequestId: done.draft.id, changeRequestTitle: done.draft.title, opened: done.draft.opened, ...done.keys, sha256 }
}
