/**
 * The platform's base knowledge on the platform door (ADR-0165, design §4.5):
 * how an operator's agent brings a country's knowledge in as a reviewed data
 * release. Every route is a `platformApiRoute`, so only a platform operator's
 * call passes; reads need `platform:settings:view`, drafting
 * `platform:knowledge:write`, review and release `platform:knowledge:review`,
 * entitlements `platform:organizations:manage`.
 *
 * The flow (ADR-0170 makes it agent-grade): read the onboarding guide and
 * schema-get; change-request-create; citation-capture for each page; then
 * records-propose (dryRun first), text-import or text-upload for each
 * manifestation's text, and validate; submit; a reviewer's
 * change-request-review per claim; change-request-decide (the person's yes,
 * never by the author); publish to preview, then stable (the person's yes);
 * rollback (the person's yes). `personDecides` makes the door ask the person,
 * and a client that cannot ask gets `decideAt`, the page where they decide it;
 * the route refuses without that yes whatever path the call took. Every write
 * takes the door's `idempotencyKey`, and every refusal is an RFC 9457 problem.
 */

import { z } from 'zod'
import { corpusQuerySchema } from '@/lib/knowledge/corpus-query'
import {
  approvalBodySchema,
  captureBodySchema,
  schemaQuerySchema,
  createChangeRequestBodySchema,
  entitleBodySchema,
  homeCountryBodySchema,
  listOrganizationCountriesQuerySchema,
  listChangeRequestsQuerySchema,
  PROPOSED_RECORD_TYPES,
  proposeRecordsBodySchema,
  publishBodySchema,
  reviewBodySchema,
  rollbackBodySchema,
  territoryImportBodySchema,
} from '@/lib/base-knowledge/platform/wire'
import { importTextBodySchema, listTextsQuerySchema, uploadTextFields } from '@/lib/base-knowledge/platform/text-wire'
import { releaseExportParamsSchema, releaseImportFields } from '@/lib/base-knowledge/platform/release-wire'
import { goldenRunAdvanceBodySchema, goldenRunBodySchema, goldenRunParamsSchema } from '@/lib/base-knowledge/wire/golden-case'
import { addDocumentBodySchema, listWorksQuerySchema, uploadDocumentFields } from '@/lib/base-knowledge/platform/document-add-wire'
import type { AgentOperation, PersonConfirmation } from '../operation'
import { MAX_UPLOAD_BYTES, uploadBodySchemaWith } from '../upload-wire'

/** Whether a review's verdicts vouch for a source (`sourceChecked`): the one verdict the person must give themselves. */
function checksASource(body: unknown): boolean {
  const decisions = (body as { decisions?: unknown } | null)?.decisions
  return Array.isArray(decisions) && decisions.some((decision) => (decision as { sourceChecked?: unknown } | null)?.sourceChecked === true)
}

/** Where the person approves, publishes, rolls back or entitles in the app: the platform's countries view. */
const IN_COUNTRIES_VIEW: PersonConfirmation = { decideAt: () => '/app/platform/countries' }

const requestParams = z.object({
  changeRequestId: z.uuid().describe('The change request id, from platform-knowledge-change-request-create or -list.'),
})
const countryParams = z.object({
  countryId: z.string().describe('The country, ISO 3166-1 alpha-2, from platform-knowledge-overview-get.'),
})
const ADDED_DOCUMENT =
  'Goes into the country’s open draft change request, or a new one titled for the document when none is open. Proposes ' +
  'the work (when new), the edition and its manifestation, each quoting where the document prints the work’s designation ' +
  'or title and the edition’s label, then attaches the PDF. Returns `changeRequestId`, `opened` (a new request), the keys ' +
  'and the text’s `sha256`. Refused with EDITION_EXISTS when the work has that edition, NOT_PRINTED when the document does ' +
  'not print the designation or label as given. A text step that fails leaves the records in the draft and its refusal ' +
  'carries `changeRequestId`: the same call again reuses the capture and the records and attaches only the text. Then ' +
  'platform-knowledge-validate and -change-request-submit.'
const organizationParams = z.object({
  organizationId: z.string().describe('The organization id, from platform-overview-get.'),
})

export const platformKnowledgeOperations = [
  {
    name: 'platform-knowledge-overview-get',
    domain: 'platform',
    summary: 'Read the platform’s base knowledge by country, and the review queue',
    description:
      'Per country: released records by type (territory, authority, work, edition, manifestation), open change requests, ' +
      'entitled offices and editions past their check target; and the queue: the submitted change requests awaiting review, ' +
      'and every request approved alone (`approval: single`) whose second review is still due.',
    method: 'GET',
    path: '/api/platform/knowledge',
    load: () => import('@/app/api/platform/knowledge/route'),
  },
  {
    name: 'platform-knowledge-change-request-list',
    domain: 'platform',
    summary: 'List the platform’s knowledge change requests',
    description: 'Newest first, at most 200; filter by `status` and by `countryId` for one country.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests',
    query: listChangeRequestsQuerySchema,
    load: () => import('@/app/api/platform/knowledge/change-requests/route'),
  },
  {
    name: 'platform-knowledge-change-request-create',
    domain: 'platform',
    summary: 'Open a change request for one country’s platform knowledge',
    description:
      'Opens a draft. Every change to platform knowledge goes through one: propose records into it, submit it, have it ' +
      'reviewed and approved by another person, then publish it.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests',
    body: createChangeRequestBodySchema,
    idempotent: false,
    load: () => import('@/app/api/platform/knowledge/change-requests/route'),
  },
  {
    name: 'platform-knowledge-change-request-get',
    domain: 'platform',
    summary: 'Read a change request with its claims, verdicts, approvals and releases',
    description:
      'Each record’s newest revision in the request, every claim (a body field) with the newest verdict on it, the ' +
      'approvals (with the reason of one given alone), and the release moves. `approval` is four_eyes, or single when its ' +
      'author approved it alone; then `secondReview` says whether another person’s review is due, confirmed or disputed.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/route'),
  },
  {
    name: 'platform-knowledge-schema-get',
    domain: 'platform',
    summary: 'Read the JSON Schema of each platform record type',
    description:
      `What platform-knowledge-records-propose takes, per record type (${PROPOSED_RECORD_TYPES.join(', ')}; \`type\` for one), ` +
      'the citation every record carries, the batch limit and the checks of the ' +
      'validation kit with what to do about each. Read it before the first proposal.',
    method: 'GET',
    path: '/api/platform/knowledge/schemas',
    query: schemaQuerySchema,
    load: () => import('@/app/api/platform/knowledge/schemas/route'),
  },
  {
    name: 'platform-knowledge-citation-capture',
    domain: 'platform',
    summary: 'Capture a page that platform records will cite',
    description:
      'Into a draft change request. `basis: fetched` fetches the URL now through the public-source fetcher, on a host ' +
      'of the configured source `sourceId` (e.g. at-ris), and stores its sha256 and text; `basis: operator_supplied` ' +
      'stores the text you copied from a page that cannot be fetched, which the reviewer must check against its source. ' +
      'The answer says `countsAsFetched`: true only through a built-in source or a released source another person approved. ' +
      'A fetch through a source proposed in this draft works for testing, and is checked by the reviewer like a pasted page. ' +
      'Returns `captureId`: cite it with a quote copied exactly from the page; the kit checks every quote (KC-6). ' +
      'A fetched capture of a PDF is also what proves a `pdf_document` source: name its `captureId` as the response of the ' +
      'source’s fixture for that URL, in place of the PDF’s bytes.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/captures',
    params: requestParams,
    body: captureBodySchema,
    examples: [
      {
        params: { changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e' },
        body: { basis: 'fetched', sourceId: 'at-ris', url: 'https://www.ris.bka.gv.at/eli/lgbl/wi/1930/11' },
      },
    ],
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/captures/route'),
  },
  {
    name: 'platform-knowledge-text-import',
    domain: 'platform',
    summary: 'Attach a text to a manifestation from a URL',
    description:
      'Into a draft change request: the PDF at `url`, on a host of the configured source `sourceId`, becomes the text of ' +
      'the manifestation `manifestationKey` (proposed before with platform-knowledge-records-propose, corpusFile null). ' +
      'Fetched and read by the public-source fetcher, kept in the base corpus where nobody reads it until the request is ' +
      'published as "<manifestationKey>-<12 hex of its sha256>.pdf", and set as the manifestation’s `corpusFile`. Returns the ' +
      'text with its `sha256`; the same PDF again changes nothing, and another PDF is another file: nothing is replaced. A URL ' +
      'that answers no PDF is refused with NOT_A_PDF and a PDF the fetcher cannot read with its PDF code. A text fetched ' +
      'through a built-in source or a released source another person approved needs no source check (`countsAsFetched`); one ' +
      'fetched through a source proposed in this draft is checked by another person like an upload. Then platform-knowledge-validate.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/texts',
    params: requestParams,
    body: importTextBodySchema,
    idempotent: true,
    examples: [
      {
        params: { changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e' },
        body: { manifestationKey: 'at-oib-rl-1-2019-text', sourceId: 'at-oib', url: 'https://www.oib.or.at/sites/default/files/oib-rl-1-2019.pdf' },
      },
    ],
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/texts/route'),
  },
  {
    name: 'platform-knowledge-text-upload',
    domain: 'platform',
    summary: 'Attach an uploaded PDF to a manifestation as its text',
    description:
      'Into a draft change request, when no configured source serves the PDF; otherwise use platform-knowledge-text-import, ' +
      `which sends no bytes through the tool call. Send \`body.files[0]\` as { name, mimeType, contentBase64 } (one PDF, up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB) ` +
      'and `body.fields.manifestationKey`. The file is kept in the base corpus as "<manifestationKey>-<12 hex of its sha256>.pdf", ' +
      'whatever the upload was called, where nobody reads it until the request is published, and set as the manifestation’s ' +
      '`corpusFile`. Returns the text with its `sha256`; the same file again changes nothing, and another file is another ' +
      'name: nothing is replaced. Nobody fetched an uploaded text, so another person checks it against its source ' +
      '(`sourceChecked`) before anyone approves, alone or not.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/texts/upload',
    params: requestParams,
    body: uploadBodySchemaWith(uploadTextFields),
    bodyEncoding: 'multipart',
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/texts/upload/route'),
  },
  {
    name: 'platform-knowledge-base-get',
    domain: 'platform',
    summary: 'See the whole base corpus, released or not',
    description:
      'The whole base corpus store with each document’s indexing state: `{ collectionName, summary, files: [{ fileName, state, chunkCount, docClass, displayTitle, ... }] }`. ' +
      'It includes documents no release marked and documents a rollback withdrew, which no organization reads. Which country reads a document is in platform-knowledge-text-list. ' +
      'The whole store with summaries is longer than one result: narrow it with `nameContains` and `countryId` (or `none`), leave out the summaries with `brief: true`, and page with `limit` and `cursor` (`matched`, `nextCursor`).',
    method: 'GET',
    path: '/api/platform/knowledge/documents',
    query: corpusQuerySchema,
    load: () => import('@/app/api/platform/knowledge/documents/route'),
  },
  {
    name: 'platform-knowledge-document-get',
    domain: 'platform',
    summary: 'Read any base-corpus PDF, released or not',
    description:
      'The PDF of one document of the base corpus store, returned as an attached resource up to 5 MiB; a larger file is not sent. ' +
      'It serves documents no organization reads too. The file name comes from platform-knowledge-base-get.',
    method: 'GET',
    path: '/api/platform/knowledge/documents/[fileName]',
    params: z.object({ fileName: z.string().describe('The base-corpus file name, exactly as platform-knowledge-base-get lists it.') }),
    binaryResponse: ['application/pdf'],
    load: () => import('@/app/api/platform/knowledge/documents/[fileName]/route'),
  },
  {
    name: 'platform-knowledge-text-get',
    domain: 'platform',
    summary: 'Read the text of a manifestation of a change request',
    description:
      'The PDF a manifestation of the change request names as its text, returned as an attached resource up to 5 MiB: what ' +
      'a reviewer compares with its source before `sourceChecked`. Served only while the base corpus keeps the bytes the ' +
      'manifestation’s revision names (`sha256` on platform-knowledge-change-request-get); other bytes under the file ' +
      'name are refused with TEXT_CHANGED and no text.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/texts/[manifestationKey]',
    params: requestParams.extend({ manifestationKey: z.string().describe('The manifestation’s key, as it was proposed.') }),
    binaryResponse: ['application/pdf'],
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/texts/[manifestationKey]/route'),
  },
  {
    name: 'platform-knowledge-text-list',
    domain: 'platform',
    summary: 'List where each base-corpus file belongs: its country, edition and change request',
    description:
      'One entry per base-corpus file a platform record names as its text: `countryId`, the manifestation (`recordId`), ' +
      'its edition and work, the change request that named it and its status, and `released` (the country’s entitled ' +
      'organizations read it). A file no record names is absent. Sorted by file name; `nextCursor` pages on.',
    method: 'GET',
    path: '/api/platform/knowledge/texts',
    query: listTextsQuerySchema,
    load: () => import('@/app/api/platform/knowledge/texts/route'),
  },
  {
    name: 'platform-knowledge-work-list',
    domain: 'platform',
    summary: 'List a country’s released works with their editions',
    description:
      'Each released work of `countryId` with its `workKey`, title, designation and kind, and its released editions’ labels: ' +
      'what platform-knowledge-document-add files a PDF under, by `workKey`. Sorted by key; `nextCursor` pages on.',
    method: 'GET',
    path: '/api/platform/knowledge/countries/[countryId]/works',
    params: countryParams,
    query: listWorksQuerySchema,
    load: () => import('@/app/api/platform/knowledge/countries/[countryId]/works/route'),
  },
  {
    name: 'platform-knowledge-document-add',
    domain: 'platform',
    summary: 'Add a PDF to a country from its publisher’s URL, in one call',
    description:
      'The whole flow for one document: `url` is the PDF on a host of one of the country’s sources (refused with ' +
      'HOST_NOT_ON_SOURCE otherwise, and NOT_A_PDF when it answers no PDF). The platform fetches it, so its origin is proven. ' +
      '`work` is `{workKey}` from platform-knowledge-work-list or a new `{title, designation, kind}`. ' +
      ADDED_DOCUMENT +
      ' TEXT_CHANGED when the text fetched is other bytes than the capture the records quote.',
    method: 'POST',
    path: '/api/platform/knowledge/countries/[countryId]/documents',
    params: countryParams,
    body: addDocumentBodySchema,
    idempotent: true,
    examples: [
      {
        params: { countryId: 'XX' },
        body: { url: 'https://publisher.example/files/guideline-1-2019.pdf', work: { workKey: 'xx-guideline-1' }, label: 'April 2019', inForceFrom: null },
      },
    ],
    load: () => import('@/app/api/platform/knowledge/countries/[countryId]/documents/route'),
  },
  {
    name: 'platform-knowledge-document-add-upload',
    domain: 'platform',
    summary: 'Add an uploaded PDF to a country, in one call',
    description:
      'When no source of the country serves the PDF; otherwise use platform-knowledge-document-add. Send `body.files[0]` ' +
      `(one PDF, up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB) and \`body.fields\`: \`work\` as JSON, \`label\`, \`inForceFrom\`, ` +
      '`publishedAt` (where the publisher publishes it) and `titleText` (the title lines copied from the PDF, which the records ' +
      'quote; the platform does not read the PDF). Nobody fetched it, so the reviewer checks both against the file before anyone approves. ' +
      ADDED_DOCUMENT,
    method: 'POST',
    path: '/api/platform/knowledge/countries/[countryId]/documents/upload',
    params: countryParams,
    body: uploadBodySchemaWith(uploadDocumentFields),
    bodyEncoding: 'multipart',
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/countries/[countryId]/documents/upload/route'),
  },
  {
    name: 'platform-knowledge-records-propose',
    domain: 'platform',
    summary: 'Propose up to 200 cited records into a draft change request',
    description:
      `Records of any type by key (a territory by its id): ${PROPOSED_RECORD_TYPES.join(', ')}; shapes ` +
      'from platform-knowledge-schema-get. Each cites a capture with a quote. Run it with `dryRun: true` first: every ' +
      'record gets its result and its problems (code, JSON Pointer, hint) and nothing is written. A batch with a ' +
      'problem is refused whole (422). The same key again adds a revision to the same record; the same proposal ' +
      'again changes nothing (`unchanged`), so a repaired batch is resent as it is. Then platform-knowledge-validate. ' +
      'A source whose fixture names no capture yet (`captureId: null`) is written with `awaiting` on its result: capture ' +
      'the URL through it, then propose it again with the capture’s id.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/records',
    params: requestParams,
    body: proposeRecordsBodySchema,
    idempotent: true,
    examples: [
      {
        params: { changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e' },
        body: {
          dryRun: true,
          records: [
            {
              type: 'edition',
              key: 'at-9-building-code-2024',
              workKey: 'at-9-building-code',
              label: '2024-01-01',
              citations: [{ captureId: '6f0c1a7e-2b7d-4c55-9a3e-6d1f0b2a9c11', quote: 'LGBl. Nr. 11/1930' }],
            },
          ],
        },
      },
    ],
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/records/route'),
  },
  {
    name: 'platform-knowledge-validate',
    domain: 'platform',
    summary: 'Run the validation kit on a whole change request',
    description:
      'The newest proposal of every record in the request, checked as submit checks it: `valid`, and each problem with ' +
      'its record, code (KC-1 references and attached texts, KC-3 intervals, KC-6 captured quotes), JSON Pointer and hint. Writes nothing. ' +
      'Repair with platform-knowledge-records-propose, then submit once it is valid.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/validation',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/validation/route'),
  },
  {
    name: 'platform-knowledge-release-export',
    domain: 'platform',
    summary: 'Export a country’s stable release as one bundle file, to import on another deployment',
    description:
      'Reads the stable revision of every platform record of the country and answers one versioned bundle as a gzipped ' +
      'JSON file (`knowledge-release-<country>-<seq>.json.gz`): each record as the proposal it was published from ' +
      '(records name each other by key, so they resolve anywhere), the captures its citations name with their text, ' +
      'URL, sha256 and basis, each attached text as its file name, URL and sha256 (never the PDF), and `requires`: ' +
      'records of other countries it names. Writes nothing. Refused while a second review disputes a released record. ' +
      'Upload the file unchanged to platform-knowledge-release-import on the other deployment.',
    method: 'GET',
    path: '/api/platform/knowledge/releases/[countryId]',
    params: releaseExportParamsSchema,
    load: () => import('@/app/api/platform/knowledge/releases/[countryId]/route'),
  },
  {
    name: 'platform-knowledge-release-import',
    domain: 'platform',
    summary: 'Import another deployment’s release bundle as a new draft change request',
    description:
      'Send the file platform-knowledge-release-export answered as `body.files[0]` ({ name, mimeType, contentBase64 }, ' +
      `up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB) and optionally \`body.fields.title\`. Writes it into a NEW draft ` +
      'change request of its country, and nothing more: it never submits, approves or publishes, so the draft is ' +
      'reviewed here with four eyes like any other. The records are checked as a proposal is first; a bundle that ' +
      'fails is refused whole (422 with the problems) and leaves nothing behind. Every capture comes in as ' +
      'operator-supplied (nobody fetched it here), so a reviewer checks it against its source (`sourceChecked`) ' +
      'before approval. Each manifestation names the released file: attach bytes with the released sha256 through ' +
      'platform-knowledge-text-import (the text’s `url` and `sourceId`) or platform-knowledge-text-upload; other ' +
      'bytes are refused (`TEXT_NOT_RELEASED`). Answers the draft’s id and the `texts` to attach. Refused with ' +
      '`REFERENCE_NOT_RELEASED` while a record names another country’s record this deployment has not released to ' +
      'stable: import and publish that country first. The same bundle again answers the request it went into, ' +
      '`unchanged`, with its `requestStatus`. Then platform-knowledge-validate and platform-knowledge-change-request-submit.',
    method: 'POST',
    path: '/api/platform/knowledge/releases',
    body: uploadBodySchemaWith(releaseImportFields),
    bodyEncoding: 'multipart',
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/releases/route'),
  },
  {
    name: 'platform-territory-import',
    domain: 'platform',
    summary: 'Import ISO 3166 territories into a draft change request',
    description:
      'A bulk file of ISO 3166 rows (`code`, `name`, optional `parent`) becomes territory records: a code without a ' +
      'subdivision is a country, `AT-6` a state of AT. `captureId` is the capture of the list; each name is checked ' +
      'against it. Validated (`dryRun` first) and reviewed like any proposal; the same rows again change nothing.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/territories',
    params: requestParams,
    body: territoryImportBodySchema,
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/territories/route'),
  },
  {
    name: 'platform-knowledge-change-request-submit',
    domain: 'platform',
    summary: 'Submit a draft change request for review',
    description:
      'No more records go into it after this. 409 unless it is a draft; 422 when it holds no records or fails ' +
      'platform-knowledge-validate, with the problems.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/submit',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/submit/route'),
  },
  {
    name: 'platform-knowledge-change-request-review',
    domain: 'platform',
    summary: 'Record verdicts on the claims of a change request under review',
    description:
      'One verdict per claim (`revisionId`, `claimPath` from platform-knowledge-change-request-get): accepted, edited or ' +
      'rejected; `sourceChecked` when you checked the cited capture, or the manifestation’s text, against its source, which ' +
      'an operator-supplied capture and a text nobody fetched (uploaded, or only named) need before approval; a verdict ' +
      'that sets it is the person’s own and is asked of them. A verdict is ' +
      'not an approval and changes nothing offices read. Refused (409) for anyone who wrote a revision in the ' +
      'request, except on a deployment set to one operator alone (dev): there the author records verdicts, ' +
      '`sourceChecked` included, on their own request. A verdict sent without the person’s confirmation is recorded as ' +
      'the agent’s. A request approved alone stays reviewable until its second review is given.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/review',
    params: requestParams,
    body: reviewBodySchema,
    idempotent: false,
    // `sourceChecked` vouches for a page nobody fetched: the person's own, asked of them (ADR-0170).
    personDecidesWhen: (input) => checksASource(input.body),
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/review/route'),
  },
  {
    name: 'platform-knowledge-change-request-decide',
    domain: 'platform',
    summary: 'Approve or reject a submitted change request, or give the second review of one approved alone',
    description:
      'The person’s own decision, asked of them. Every request needs a domain expert’s approval (`role: domain_expert`); ' +
      'approval needs every claim accepted, is refused (409) for anyone ' +
      'who wrote a revision in the request, and (403) in a `role` the person does not hold. A request holding an ' +
      'advice policy also needs `counsel`, one holding a site-keyed source a `privacy_reviewer`: until then it stays ' +
      'submitted and answers `awaiting`. A draft can be rejected too, which closes a monitor’s request with nothing to do. ' +
      '`override: {reason}` lets an author approve alone when nobody else can: it needs platform:knowledge:approve_alone ' +
      '(403 without), is refused while a pasted capture is not source-checked by another person, is never implied, and marks the request `approval: single` with a second review due; propose it ' +
      'and ask, the person decides. On a deployment set to one operator alone (dev) the author’s own source check ' +
      'counts and no second review is due (`secondReview: null`): the author reviews, approves with the override and ' +
      'publishes alone, still audited and marked `single`; the 409 that names the source check says which applies. A reject, like an approve, needs the `role` the person holds (403 otherwise). On an ' +
      'approved request whose second review is due, another person gives it in each role approved alone they hold ' +
      '(`secondReviewRoles`): approve (every claim accepted) confirms that role, reject disputes the request. A disputed ' +
      'request is not published further; rejecting it again withdraws its preview, and a published one is rolled back ' +
      '(platform-knowledge-rollback), each a separate decision. Answers `secondReviewDue`, the roles still owed. Audited.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/decision',
    params: requestParams,
    body: approvalBodySchema,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/decision/route'),
  },
  {
    name: 'platform-knowledge-publish',
    domain: 'platform',
    summary: 'Publish an approved change request to preview or stable',
    description:
      'Preview first; stable then moves what every entitled office reads and queues each published text for indexing. ' +
      'The person’s own decision. 409 when another request released one of its records since it was opened. Audited.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/publish',
    params: requestParams,
    body: publishBodySchema,
    destructive: true,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/publish/route'),
  },
  {
    name: 'platform-knowledge-rollback',
    domain: 'platform',
    summary: 'Roll back a published change request',
    description:
      'Each record returns to its state before the request, as appended inverse releases; revisions stay, so old ' +
      'citations resolve. The person’s own decision. 409 when a later release moved a record again. Audited.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/rollback',
    params: requestParams,
    body: rollbackBodySchema,
    destructive: true,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/rollback/route'),
  },
  {
    name: 'platform-knowledge-index-status',
    domain: 'platform',
    summary: 'Read whether a change request’s published texts are indexed',
    description:
      'Per text: requested, queued (the base corpus accepted it), indexed (the corpus reports its chunks) or failed ' +
      'with the reason.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/index-status',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/index-status/route'),
  },
  {
    name: 'platform-knowledge-golden-run',
    domain: 'platform',
    summary: 'Run a country’s golden cases through the real answer path and score them',
    description:
      'Starts a run of the country’s golden cases (golden_case records): the released ones, or with `changeRequestId` ' +
      'those of a change request published to preview. Each case is asked as you, in the platform organization, as ' +
      'agent-ask-create asks, at the site and with the facts the case states, on the law released for that country; ' +
      'the platform organization must be entitled to it. Each answer is scored against its case: expected values ' +
      'present, the edition named, each citation resolving to a cited source and its locus, no must-not violated, ' +
      'with its seconds and its cost from the usage ledger. An expectation with grounding `unconfirmed` is scored and ' +
      'never decides the case. Asks four cases at once and returns the run; then call ' +
      'platform-knowledge-golden-run-advance until `finishedAt` is set. Uses the platform organization’s model ' +
      'budget. Scores are on each answer’s Langfuse trace, under the dataset run `datasetRun`.',
    method: 'POST',
    path: '/api/platform/knowledge/golden-runs',
    body: goldenRunBodySchema,
    idempotent: false,
    examples: [{ body: { countryId: 'XA' } }],
    load: () => import('@/app/api/platform/knowledge/golden-runs/route'),
  },
  {
    name: 'platform-knowledge-golden-run-advance',
    domain: 'platform',
    summary: 'Step a golden run: score the cases that were answered and ask the next',
    description:
      'Waits up to `waitSeconds` for the running cases, scores those whose answer arrived, asks the next pending ' +
      'cases (four at once) and returns the run as platform-knowledge-golden-run-get does. Repeat until `finishedAt` ' +
      'is set. Only the person who started the run steps it. A case that could not be answered is settled with ' +
      '`failure` and no verdict.',
    method: 'POST',
    path: '/api/platform/knowledge/golden-runs/[runId]/advance',
    params: goldenRunParamsSchema,
    body: goldenRunAdvanceBodySchema,
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/golden-runs/[runId]/advance/route'),
  },
  {
    name: 'platform-knowledge-golden-run-get',
    domain: 'platform',
    summary: 'Read a golden run: every case with its verdict, checks and scores',
    description:
      'The run’s `summary` (cases pending, asked, settled, passed, failed, unanswered, and expectations no reviewer ' +
      'confirmed), `medianSeconds`, `medianCostUsd`, the stable `releaseSeq` it was answered on, and per case its ' +
      '`state`, `passed`, and `result`: each check (value, edition, citation, must_not) with `passed`, whether it ' +
      '`decides` and why it failed, the scores by name, the confidence the answer stated, its seconds, cost and ' +
      'trace id. The answer itself is in the asker’s own conversation, by `askId` (agent-ask-get).',
    method: 'GET',
    path: '/api/platform/knowledge/golden-runs/[runId]',
    params: goldenRunParamsSchema,
    load: () => import('@/app/api/platform/knowledge/golden-runs/[runId]/route'),
  },
  {
    name: 'platform-org-countries-list',
    domain: 'platform',
    summary: 'List where every organization is placed: its home country and the countries it is entitled to',
    description:
      'Per organization (the platform organization left out): `homeCountry`, or null with `unplaced.reason`: ' +
      '`directory_names` (its WorkOS metadata names `directoryHomeCountry`, written on the next signed-in page load), ' +
      '`no_row` (nobody signed in to it yet, and nothing names a country) or `not_stated` (its admins have not stated it). Then `entitled`: its home (source `home`) and ' +
      'each country the platform entitled it to (source `platform`, with who and when). A page at a time (`limit`, ' +
      '`cursor` from `nextCursor`), the unplaced first within it. Read only: place an office with ' +
      'platform-organization-home-country-set, entitle it with platform-org-country-entitle.',
    method: 'GET',
    path: '/api/platform/organizations/countries',
    query: listOrganizationCountriesQuerySchema,
    load: () => import('@/app/api/platform/organizations/countries/route'),
  },
  {
    name: 'platform-org-country-entitle',
    domain: 'platform',
    summary: 'Entitle an organization to a country’s platform knowledge, or withdraw it',
    description:
      'From then on the office’s answers draw on that country’s released platform knowledge (`entitled: false` ' +
      'withdraws it; its home country needs no entitlement). The person’s own decision. Audited.',
    method: 'POST',
    path: '/api/platform/organizations/[organizationId]/countries',
    params: organizationParams,
    body: entitleBodySchema,
    destructive: true,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    load: () => import('@/app/api/platform/organizations/[organizationId]/countries/route'),
  },
  {
    name: 'platform-organization-home-country-set',
    domain: 'platform',
    summary: 'Move an organization’s home country',
    description:
      'The office’s seat: one of the countries the product is offered in. The old home stays an entitlement until ' +
      'withdrawn. The person’s own decision. Audited.',
    method: 'PUT',
    path: '/api/platform/organizations/[organizationId]/home-country',
    params: organizationParams,
    body: homeCountryBodySchema,
    destructive: true,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    load: () => import('@/app/api/platform/organizations/[organizationId]/home-country/route'),
  },
] as const satisfies readonly AgentOperation[]
