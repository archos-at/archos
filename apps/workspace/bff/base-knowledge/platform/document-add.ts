/**
 * Add one document to a country in one call (Platform → a country → "Add a
 * document"): the steps of the onboarding guide for one PDF, in order, so a
 * person in the browser and an agent on the platform door do the same thing.
 *
 * 1. The country's open draft change request, or a new one titled for the document.
 * 2. A capture the records cite (KC-6): the PDF itself, fetched through the source
 *    whose host the URL is on; or, for an upload, the title lines the person
 *    copied from it (operator-supplied, checked by the reviewer against the source).
 * 3. The work (when new), the edition and its manifestation, each quoting the
 *    capture where it prints the work's designation or title and the edition's label.
 * 4. The text: fetched again by `importPlatformText`, or the uploaded bytes.
 *
 * Every step is an existing service call with its own checks; this module only
 * orders them and words what goes wrong. A step that fails after the records were
 * proposed leaves them in the draft: the same call again finishes it.
 */

import 'server-only'
import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { ApiError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { knowledgeEditionRevisions, knowledgeRecords, knowledgeWorkRevisions } from '@/lib/db/schema/knowledge-records'
import { capturesOf, isPdf } from './captures'
import { type AddDocumentBody, type AddDocumentResult, type CountryWorkView, keyPart, type ListWorksQuery, quoteNaming, type UploadDocumentFields } from './document-add-wire'
import { capturePlatformCitation } from './onboarding'
import { createPlatformChangeRequest, proposePlatformRecords } from './service'
import { requirePlatform } from './service-gate'
import { platformSourceStatus } from './source-service'
import { listChangeRequests, platformTransaction } from './store'
import { draftManifestation } from './text-store'
import { importPlatformText, uploadPlatformText } from './texts'
import { type CaptureBody, type ProposedRecord, proposedRecordSchema } from './wire'

type ProposedBy = 'person' | 'agent'
type DocumentInput = Pick<AddDocumentBody, 'work' | 'label' | 'inForceFrom'> & { licenceClass?: AddDocumentBody['licenceClass'] }

/** The released works of a country by key, a page at a time, with their released editions' labels. */
export async function listCountryWorks(
  session: UserSession | null,
  countryId: string,
  page: ListWorksQuery = { limit: 500 },
): Promise<{ works: CountryWorkView[]; nextCursor: string | null }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  return platformTransaction(async (tx) => {
    const works = await tx
      .select({ id: knowledgeRecords.id, title: knowledgeWorkRevisions.title, kind: knowledgeWorkRevisions.kind, identifiers: knowledgeWorkRevisions.identifiers })
      .from(knowledgeRecords)
      .innerJoin(knowledgeWorkRevisions, eq(knowledgeWorkRevisions.revisionId, knowledgeRecords.headRevisionId))
      .where(
        and(
          isNull(knowledgeRecords.organizationId),
          eq(knowledgeRecords.type, 'work'),
          eq(knowledgeRecords.countryId, countryId),
          page.cursor ? gt(knowledgeRecords.id, `work:${page.cursor}`) : undefined,
        ),
      )
      .orderBy(knowledgeRecords.id)
      .limit(page.limit + 1)
    const more = works.length > page.limit
    works.splice(page.limit)
    const ids = works.map((work) => work.id)
    const editions = ids.length
      ? await tx
          .select({ id: knowledgeRecords.id, workId: knowledgeEditionRevisions.workId, label: knowledgeEditionRevisions.label })
          .from(knowledgeRecords)
          .innerJoin(knowledgeEditionRevisions, eq(knowledgeEditionRevisions.revisionId, knowledgeRecords.headRevisionId))
          .where(and(isNull(knowledgeRecords.organizationId), isNotNull(knowledgeRecords.headRevisionId), inArray(knowledgeEditionRevisions.workId, ids)))
          .orderBy(sql`${knowledgeEditionRevisions.label}`)
          .limit(5000)
      : []
    return {
      nextCursor: more ? (works.at(-1)?.id.replace(/^work:/, '') ?? null) : null,
      works: works.map((work) => ({
        workKey: work.id.replace(/^work:/, ''),
        title: work.title,
        designation: (work.identifiers as { designation?: string }).designation ?? null,
        kind: work.kind,
        editions: editions.filter((edition) => edition.workId === work.id).map((edition) => ({ editionKey: edition.id.replace(/^edition:/, ''), label: edition.label })),
      })),
    }
  })
}

/** The work the document belongs to, as the records name it. */
async function resolveWork(session: UserSession, countryId: string, work: DocumentInput['work']) {
  // Every work, so the one named or a new one's key is found whatever page it is on.
  const { works } = await listCountryWorks(session, countryId, { limit: 5000 })
  if ('workKey' in work) {
    const found = works.find((one) => one.workKey === work.workKey)
    if (!found) throw new NotFoundError(`No released work ${work.workKey} in ${countryId}; list them with platform-knowledge-work-list, or name a new work.`)
    return { key: found.workKey, named: found.designation ?? found.title, editions: found.editions, record: null }
  }
  const key = `${countryId.toLowerCase()}-${keyPart(work.designation ?? work.title)}`
  const known = works.find((one) => one.workKey === key)
  const record = known ? null : { type: 'work', key, kind: work.kind, title: work.title, designation: work.designation, territoryIds: [countryId] }
  return { key, named: work.designation ?? work.title, editions: known?.editions ?? [], record }
}

/** The country's open draft (not a monitor's), or a new one titled for the document. */
async function draftFor(session: UserSession, countryId: string, title: string): Promise<{ id: string; title: string; opened: boolean }> {
  const drafts = await listChangeRequests({ status: 'draft', countryId }, { offset: 0, limit: 20 })
  const open = drafts.find((draft) => draft.origin !== 'monitor')
  if (open) return { id: open.id, title: open.title, opened: false }
  return { ...(await createPlatformChangeRequest(session, { title, countryId })), title, opened: true }
}

/** The source of this country whose hosts the URL is on. */
async function sourceForUrl(session: UserSession, countryId: string, url: string): Promise<string> {
  const host = new URL(url).hostname.toLowerCase()
  const { sources } = await platformSourceStatus(session, {})
  const source = sources.find((one) => one.countryId === countryId && one.state === 'active' && one.hosts.some((entry) => entry.host === host && entry.state === 'active'))
  if (!source) {
    throw new ApiError(422, 'HOST_NOT_ON_SOURCE', `${host} is on no source of ${countryId}; nothing was written.`, {
      hint: 'Use the URL of the PDF at a host this country’s sources list (Sources tab), or upload the file and say where it is published.',
    })
  }
  return source.sourceKey
}

/** Steps 1 to 3: the draft, the capture, the records; what step 4 attaches the text to. */
async function proposeDocument(
  session: UserSession,
  countryId: string,
  input: DocumentInput,
  capture: (requestId: string) => Promise<{ captureId: string; url: string; text: string | null }>,
  proposedBy: ProposedBy,
) {
  const work = await resolveWork(session, countryId, input.work)
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
  const cited = await capture(draft.id)
  const quote = (label: string): string => {
    const found = cited.text ? quoteNaming(cited.text, label) : null
    if (found) return found
    throw new ApiError(422, 'NOT_PRINTED', `The document does not print "${label}"; nothing was proposed.`, {
      hint: 'Write the work’s designation or title and the edition’s label exactly as the document prints them.',
    })
  }
  const cite = (label: string) => [{ captureId: cited.captureId, quote: quote(label), url: cited.url }]
  // Parsed, so every field the document does not say takes the schema's default.
  const records: ProposedRecord[] = [
    ...(work.record ? [{ ...work.record, citations: cite(work.named) }] : []),
    { type: 'edition', key: editionKey, workKey: work.key, label: input.label, inForceFrom: input.inForceFrom, citations: cite(input.label) },
    { type: 'manifestation', key: manifestationKey, editionKey, licenceClass: input.licenceClass ?? 'public_open', citations: cite(input.label) },
  ].map((record) => proposedRecordSchema.parse(record))
  await proposePlatformRecords(session, draft.id, { records, dryRun: false }, proposedBy)
  return { draft, workKey: work.key, editionKey, manifestationKey }
}

const normalized = (label: string) => label.trim().toLowerCase()

async function captureWithText(session: UserSession, requestId: string, body: CaptureBody) {
  const view = await capturePlatformCitation(session, requestId, body)
  if (body.basis === 'fetched' && !isPdf(view.contentType)) {
    throw new ApiError(422, 'NOT_A_PDF', `${body.url} answers ${view.contentType ?? 'no content type'}, not a PDF; nothing was proposed.`, {
      hint: 'Give the URL of the PDF itself, not of the page that links to it.',
    })
  }
  const text = (await platformTransaction((tx) => capturesOf(tx, requestId, [view.captureId]))).get(view.captureId)?.text ?? null
  return { captureId: view.captureId, url: view.finalUrl ?? view.url, text }
}

/** Add the PDF at its publisher's URL: fetched by the platform through the country's source for that host. */
export async function addPlatformDocument(session: UserSession | null, countryId: string, body: AddDocumentBody, proposedBy: ProposedBy = 'person'): Promise<AddDocumentResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const sourceId = await sourceForUrl(person, countryId, body.url)
  const done = await proposeDocument(person, countryId, body, (id) => captureWithText(person, id, { basis: 'fetched', sourceId, url: body.url }), proposedBy)
  const attached = await importPlatformText(person, done.draft.id, { manifestationKey: done.manifestationKey, sourceId, url: body.url }, proposedBy)
  return result(done, attached.text.sha256)
}

/** Add an uploaded PDF: its records quote the title lines the person copied, which the reviewer checks against the source. */
export async function uploadPlatformDocument(
  session: UserSession | null,
  countryId: string,
  fields: UploadDocumentFields,
  file: File,
  proposedBy: ProposedBy = 'person',
): Promise<AddDocumentResult> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const head = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString('latin1')
  if (head !== '%PDF-') throw new UnprocessableError(`${file.name} is not a PDF; nothing was written.`, { hint: 'Upload the document as a PDF.' })
  const capture: CaptureBody = { basis: 'operator_supplied', url: fields.publishedAt, text: fields.titleText, note: 'Title lines copied from an uploaded PDF.' }
  const done = await proposeDocument(person, countryId, fields, (id) => captureWithText(person, id, capture), proposedBy)
  // Named after the manifestation, whatever the upload was called (`uploadPlatformText`).
  const pdf = new File([file], `${done.manifestationKey}.pdf`, { type: 'application/pdf' })
  const attached = await uploadPlatformText(person, done.draft.id, done.manifestationKey, pdf, proposedBy)
  return result(done, attached.text.sha256)
}

function result(done: Awaited<ReturnType<typeof proposeDocument>>, sha256: string | null): AddDocumentResult {
  return {
    changeRequestId: done.draft.id,
    changeRequestTitle: done.draft.title,
    opened: done.draft.opened,
    workKey: done.workKey,
    editionKey: done.editionKey,
    manifestationKey: done.manifestationKey,
    sha256: sha256 ?? '',
  }
}
