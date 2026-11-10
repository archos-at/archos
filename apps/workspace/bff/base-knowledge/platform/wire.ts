/**
 * The wire of the platform's base knowledge (ADR-0165): the records a change
 * request proposes, the review, approval, publish and rollback bodies, the
 * entitlement bodies, and what the platform view reads. Pure zod, shared by the
 * routes, the agent operations and the UI.
 *
 * A record is proposed by its key; the same key proposed again in the same
 * draft appends a revision to the same record, so a repaired batch is resent
 * as it is. Record ids are `<type>:<key>`, a territory's is its territory id.
 */

import { z } from 'zod'
import {
  APPROVAL_ROLES,
  CHANGE_REQUEST_STATUSES,
  KNOWLEDGE_WORK_KINDS,
  type KnowledgeRecordType,
  RELEASE_CHANNELS,
  REVIEW_DECISIONS,
  TERRITORY_KINDS,
} from '@/lib/base-knowledge/wire/vocab'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import { transitionTableSchema } from '@/lib/base-knowledge/wire/time'

/** ISO 3166-1 alpha-2: what an office is entitled to and a platform record belongs to. */
export const countryIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'an ISO 3166-1 alpha-2 code such as AT')

/** A territory id: ISO 3166 (`AT`, `AT-6`, `EU`) or `<CC>:<scheme>:<code>` (`AT:gkz:60101`). Frozen, never parsed. */
export const territoryIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$|^[A-Z]{2}:[a-z]{2,8}:[A-Za-z0-9]{1,20}$/, 'an ISO 3166 code such as AT-6, or CC:scheme:code')

/** A record's key within the platform: lower-case words, dots and dashes. */
const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, 'lower-case letters, digits, dots and dashes, e.g. "at-wien-ma37"')

const isoDate = z.iso.date()

/** Where a value was taken from: what a reviewer checks the claim against. */
const citationSchema = z.object({
  url: z.url().max(2000).optional(),
  note: z.string().trim().min(1).max(500).optional(),
})

const common = { citations: z.array(citationSchema).max(10).default([]) }

const workRecord = z.object({
  type: z.literal('work'),
  key: keySchema,
  kind: z.enum(KNOWLEDGE_WORK_KINDS),
  title: z.string().trim().min(1).max(300),
  designation: z.string().trim().min(1).max(120).nullable().default(null).describe('e.g. "ÖNORM B 1600".'),
  territoryIds: z.array(territoryIdSchema).max(20).default([]).describe('Where it applies; empty for a standard.'),
  issuer: z.string().trim().min(1).max(200).nullable().default(null),
  addressees: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        territoryId: territoryIdSchema,
        authorityKey: keySchema.optional().describe('The authority record it names, e.g. "at-wien-ma37".'),
      }),
    )
    .max(10)
    .default([]),
  historyAvailableFrom: isoDate.nullable().default(null).describe('The first day whose edition is held.'),
  ...common,
})

const editionRecord = z.object({
  type: z.literal('edition'),
  key: keySchema,
  workKey: keySchema.describe('The work it is an edition of, proposed here or already published.'),
  label: z.string().trim().min(1).max(120).describe('The Ausgabe as the masthead prints it, e.g. "2023-01-01".'),
  issuedOn: isoDate.nullable().default(null),
  inForceFrom: isoDate.nullable().default(null),
  inForceTo: isoDate.nullable().default(null).describe('The last day in force, inclusive; null while in force.'),
  transition: transitionTableSchema
    .nullable()
    .default(null)
    .describe('Its transitional rule: a decision table over the procedure and boundary_from giving old_law, new_law or choice.'),
  ...common,
})

const manifestationRecord = z.object({
  type: z.literal('manifestation'),
  key: keySchema,
  editionKey: keySchema,
  form: z.enum(['text', 'link']).default('text'),
  language: z.string().trim().min(2).max(35).default('de'),
  // The platform holds no licensed text (0202's CHECK); the class is offered without it.
  licenceClass: z.enum(['public_open', 'public_restricted']),
  corpusFile: z
    .string()
    .trim()
    .regex(/^[^/\\]{1,200}\.pdf$/, 'a PDF file name in the base corpus')
    .nullable()
    .default(null)
    .describe('The text, as a file uploaded to the base corpus; null for a listing without text.'),
  ...common,
})

const territoryRecord = z.object({
  type: z.literal('territory'),
  id: territoryIdSchema,
  kind: z.enum(TERRITORY_KINDS),
  name: z.string().trim().min(1).max(200),
  parentIds: z.array(territoryIdSchema).max(10).default([]).describe('Nearest first, e.g. ["AT"] for AT-6.'),
  aliases: z.record(z.string().regex(/^[a-z]{2,8}$/), z.string().min(1).max(40)).default({}),
  validFrom: isoDate.nullable().default(null),
  validTo: isoDate.nullable().default(null),
  ...common,
})

const authorityRecord = z.object({
  type: z.literal('authority'),
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  functionCodes: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(20).default([]),
  seatTerritoryId: territoryIdSchema,
  competenceTerritoryIds: z.array(territoryIdSchema).min(1).max(50),
  identifiers: z.record(z.string().regex(/^[a-z_]{2,20}$/), z.string().min(1).max(80)).default({}),
  ...common,
})

const rulesetRecord = z.object({
  type: z.literal('ruleset'),
  key: keySchema,
  values: rulesetValuesSchema.describe('A ruleset (ADR-0166); workIds are record ids such as work:at-wien-bo.'),
  ...common,
})

export const proposedRecordSchema = z.discriminatedUnion('type', [
  workRecord,
  editionRecord,
  manifestationRecord,
  territoryRecord,
  authorityRecord,
  rulesetRecord,
])
export type ProposedRecord = z.infer<typeof proposedRecordSchema>

/** The most records one proposal carries. */
export const MAX_PROPOSED_RECORDS = 200

export const createChangeRequestBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  countryId: countryIdSchema.describe('The country whose knowledge it changes; what offices are entitled to.'),
})

export const proposeRecordsBodySchema = z.object({
  records: z.array(proposedRecordSchema).min(1).max(MAX_PROPOSED_RECORDS),
  dryRun: z.boolean().default(false).describe('Validate only; nothing is written.'),
})

export const territoryImportBodySchema = z.object({
  format: z.enum(['iso3166']).describe('A bulk file of ISO 3166 rows.'),
  rows: z
    .array(
      z.object({
        code: territoryIdSchema,
        name: z.string().trim().min(1).max(200),
        parent: territoryIdSchema.optional(),
      }),
    )
    .min(1)
    .max(MAX_PROPOSED_RECORDS),
})

export const reviewBodySchema = z.object({
  decisions: z
    .array(
      z.object({
        revisionId: z.uuid(),
        claimPath: z.string().trim().min(1).max(120),
        decision: z.enum(REVIEW_DECISIONS),
        note: z.string().trim().min(1).max(2000).optional(),
      }),
    )
    .min(1)
    .max(500),
})

export const approvalBodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
  role: z.enum(APPROVAL_ROLES).default('domain_expert'),
})

export const publishBodySchema = z.object({
  channel: z.enum(RELEASE_CHANNELS).describe('preview first; stable moves what offices read.'),
})

export type ReleaseChannelBody = z.infer<typeof publishBodySchema>
export type ReviewDecisionBody = z.infer<typeof reviewBodySchema>

export const rollbackBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000),
})

/** A page of change requests: the default and the most one call returns. */
export const CHANGE_REQUEST_PAGE = 50
export const MAX_CHANGE_REQUEST_PAGE = 200

export const listChangeRequestsQuerySchema = z.object({
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CHANGE_REQUEST_PAGE).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional().describe('nextCursor of the previous page.'),
})

export const entitleBodySchema = z.object({
  countryId: countryIdSchema,
  entitled: z.boolean().describe('false withdraws the entitlement.'),
})

export const homeCountryBodySchema = z.object({ countryId: countryIdSchema })

/** One claim of one revision, with the reviewer's newest verdict on it. */
export interface ClaimView {
  path: string
  value: unknown
  decision: (typeof REVIEW_DECISIONS)[number] | null
}

export interface RevisionView {
  revisionId: string
  recordId: string
  type: KnowledgeRecordType
  createdBy: string
  citations: z.infer<typeof citationSchema>[]
  claims: ClaimView[]
}

export interface ChangeRequestView {
  id: string
  title: string
  countryId: string
  status: (typeof CHANGE_REQUEST_STATUSES)[number]
  createdBy: string
  createdAt: string
  submittedAt: string | null
  publishedAt: string | null
  revisions: RevisionView[]
  approvals: { approver: string; role: string; decisionSource: string; decidedAt: string }[]
  releases: { seq: number; recordId: string; channel: string; action: string; toRevisionId: string | null; releasedAt: string }[]
}

export interface ChangeRequestSummary {
  id: string
  title: string
  countryId: string
  status: (typeof CHANGE_REQUEST_STATUSES)[number]
  createdBy: string
  createdAt: string
  revisionCount: number
}

export interface CountryCoverage {
  countryId: string
  /** Released records by type. */
  released: Record<string, number>
  openRequests: number
  entitledOffices: number
  /** Released editions whose newest platform check is past its freshness target, or that were never checked. */
  overdueEditions: number
}

export interface PlatformKnowledgeOverview {
  countries: CountryCoverage[]
  queue: ChangeRequestSummary[]
}

export interface IndexStatusView {
  changeRequestId: string
  texts: { revisionId: string; corpusFile: string; state: 'requested' | 'queued' | 'failed' | 'indexed'; failure: string | null }[]
}

export interface OrganizationCountriesView {
  homeCountry: string | null
  entitled: { countryId: string; source: 'home' | 'platform'; entitledAt: string | null }[]
}
