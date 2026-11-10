/**
 * The platform's base knowledge on the platform door (ADR-0165, design §4.5):
 * how an operator's agent brings a country's knowledge in as a reviewed data
 * release. Every route is a `platformApiRoute`, so only a platform operator's
 * call passes; reads need `platform:settings:view`, writes
 * `platform:settings:manage`, entitlements `platform:organizations:manage`.
 *
 * The flow: change-request-create, records-propose (dryRun first), submit;
 * a reviewer's change-request-review per claim; change-request-decide (the
 * person's yes, never by the author); publish to preview, then stable (the
 * person's yes); rollback (the person's yes). `personDecides` makes the door ask
 * the person; the route refuses without that yes whatever path the call took.
 */

import { z } from 'zod'
import {
  approvalBodySchema,
  createChangeRequestBodySchema,
  entitleBodySchema,
  homeCountryBodySchema,
  listChangeRequestsQuerySchema,
  proposeRecordsBodySchema,
  publishBodySchema,
  reviewBodySchema,
  rollbackBodySchema,
  territoryImportBodySchema,
} from '@/lib/base-knowledge/platform/wire'
import type { AgentOperation } from '../operation'

const requestParams = z.object({
  changeRequestId: z.uuid().describe('The change request id, from platform-knowledge-change-request-create or -list.'),
})
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
      'entitled offices and editions past their check target; and the submitted change requests awaiting review.',
    method: 'GET',
    path: '/api/platform/knowledge',
    load: () => import('@/app/api/platform/knowledge/route'),
  },
  {
    name: 'platform-knowledge-change-request-list',
    domain: 'platform',
    summary: 'List the platform’s knowledge change requests',
    description: 'Newest first, at most 200; filter by `status`.',
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
      'approvals, and the release moves.',
    method: 'GET',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/route'),
  },
  {
    name: 'platform-knowledge-records-propose',
    domain: 'platform',
    summary: 'Propose up to 200 cited records into a draft change request',
    description:
      'Records of any type by key (a territory by its id): territory, authority, work, edition, manifestation. Run it ' +
      'with `dryRun: true` first: it answers the validation problems and writes nothing. A batch with problems is ' +
      'refused (422). The same key again in the same draft adds a revision to the same record.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/records',
    params: requestParams,
    body: proposeRecordsBodySchema,
    idempotent: false,
    examples: [
      {
        params: { changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e' },
        body: {
          dryRun: true,
          records: [
            { type: 'work', key: 'oenorm-b-5371', kind: 'technical_standard', title: 'Treppen', designation: 'ÖNORM B 5371' },
            { type: 'edition', key: 'oenorm-b-5371-2021', workKey: 'oenorm-b-5371', label: '2021-01-15' },
          ],
        },
      },
    ],
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/records/route'),
  },
  {
    name: 'platform-territory-import',
    domain: 'platform',
    summary: 'Import ISO 3166 territories into a draft change request',
    description:
      'A bulk file of ISO 3166 rows (`code`, `name`, optional `parent`) becomes territory records: a code without a ' +
      'subdivision is a country, `AT-6` a state of AT. Validated and reviewed like any proposal.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/territories',
    params: requestParams,
    body: territoryImportBodySchema,
    idempotent: false,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/territories/route'),
  },
  {
    name: 'platform-knowledge-change-request-submit',
    domain: 'platform',
    summary: 'Submit a draft change request for review',
    description: 'No more records go into it after this. 409 unless it is a draft; 422 when it holds no records.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/submit',
    params: requestParams,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/submit/route'),
  },
  {
    name: 'platform-knowledge-change-request-review',
    domain: 'platform',
    summary: 'Record verdicts on the claims of a submitted change request',
    description:
      'One verdict per claim (`revisionId`, `claimPath` from platform-knowledge-change-request-get): accepted, edited or ' +
      'rejected. A verdict is not an approval and changes nothing offices read. Refused (409) for anyone who wrote a ' +
      'revision in the request; a verdict sent without the person’s confirmation is recorded as the agent’s.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/review',
    params: requestParams,
    body: reviewBodySchema,
    idempotent: false,
    load: () => import('@/app/api/platform/knowledge/change-requests/[changeRequestId]/review/route'),
  },
  {
    name: 'platform-knowledge-change-request-decide',
    domain: 'platform',
    summary: 'Approve or reject a submitted change request',
    description:
      'The person’s own decision, asked of them; approval needs every claim accepted, is refused (409) for anyone ' +
      'who wrote a revision in the request, and (403) in a `role` the person does not hold. Audited.',
    method: 'POST',
    path: '/api/platform/knowledge/change-requests/[changeRequestId]/decision',
    params: requestParams,
    body: approvalBodySchema,
    personDecides: true,
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
    load: () => import('@/app/api/platform/organizations/[organizationId]/home-country/route'),
  },
] as const satisfies readonly AgentOperation[]
