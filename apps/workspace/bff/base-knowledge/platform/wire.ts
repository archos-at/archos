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
  BINDING_MODES,
  CHANGE_REQUEST_ORIGINS,
  CHANGE_REQUEST_STATUSES,
  type ChangeRequestApproval,
  CONNECTING_FACTORS,
  COVERAGE_LEVELS,
  KNOWLEDGE_WORK_KINDS,
  type KnowledgeRecordType,
  RELATION_END_TYPES,
  RELATION_TYPES,
  RELEASE_CHANNELS,
  REVIEW_DECISIONS,
  SECOND_REVIEW_STATES,
  type SecondReviewState,
  TERRITORY_KINDS,
} from '@/lib/base-knowledge/wire/vocab'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import { sourceRecordFields } from '@/lib/base-knowledge/wire/source'
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

/** A capture's id, from platform-knowledge-citation-capture. */
const captureIdSchema = z.uuid()

/**
 * Where a value was taken from: what a reviewer checks the claim against. A
 * platform record cites at least one capture of its change request, with the
 * words that support it (KC-6, ADR-0170); a bare `url` is no citation.
 */
export const citationSchema = z.object({
  captureId: captureIdSchema.optional().describe('A capture of this change request, from platform-knowledge-citation-capture.'),
  quote: z
    .string()
    .trim()
    .min(2)
    .max(2000)
    .optional()
    .describe('Words copied exactly from the capture that support the record; checked against the stored capture (KC-6).'),
  url: z.url().max(2000).optional().describe('The page, for a person to open; the capture is what is checked.'),
  note: z.string().trim().min(1).max(500).optional(),
})
export type Citation = z.infer<typeof citationSchema>

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
  connectsBy: z
    .array(z.enum(CONNECTING_FACTORS))
    .min(1)
    .max(3)
    .default(['site'])
    .describe('What the work attaches to: site, office_seat (HOAI), client (VgV). Anything but site never binds by the site alone.'),
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
  datedParents: z
    .array(
      z.object({
        id: territoryIdSchema,
        validFrom: isoDate.nullable().default(null),
        validTo: isoDate.nullable().default(null),
      }),
    )
    .max(10)
    .default([])
    .describe('Parents for an interval only, half-open: [{ id: "EU", validFrom: "1995-01-01" }] for AT.'),
  aliases: z.record(z.string().regex(/^[a-z]{2,8}$/), z.string().min(1).max(40)).default({}),
  validFrom: isoDate.nullable().default(null),
  validTo: isoDate.nullable().default(null),
  coverageLevel: z
    .enum(COVERAGE_LEVELS)
    .nullable()
    .default(null)
    .describe('How far the records go here (none, open, core, full); null inherits from the parent. Only a publish changes it.'),
  municipalLaw: z.boolean().nullable().default(null).describe('Whether this node’s own municipal law is held.'),
  ...common,
})

/** An AKN eId (`par_4__abs_2`, `pkt_3.1`, `cl_4.2`): what an anchor names, never prose. */
const anchorIdSchema = z.string().trim().regex(/^[a-z]{2,6}_[A-Za-z0-9.]{1,20}(__[a-z]{2,6}_[A-Za-z0-9.]{1,20}){0,5}$/, 'an AKN eId such as par_4__abs_2 or pkt_3.1')

const relationEnd = z.object({
  type: z.enum(RELATION_END_TYPES),
  key: keySchema.describe('The work or edition, proposed here or already published, in any pack.'),
})

const relationRecord = z
  .object({
    type: z.literal('relation'),
    key: keySchema,
    relationType: z.enum(RELATION_TYPES),
    mode: z.enum(BINDING_MODES).nullable().default(null).describe('Only for makes_binding: declared, static_reference or dynamic_reference.'),
    from: relationEnd.describe('The instrument that binds, displaces, supersedes or interprets.'),
    to: relationEnd,
    anchors: z
      .array(z.object({ from: anchorIdSchema.optional(), to: anchorIdSchema.optional() }))
      .max(50)
      .default([])
      .describe('Paired clauses; empty for the whole instrument. A deviates_from names at least one.'),
    provision: z.string().trim().min(1).max(120).nullable().default(null).describe('Where the from-instrument says so, e.g. "§ 1 WBTV 2023".'),
    validFrom: isoDate.nullable().default(null),
    validTo: isoDate.nullable().default(null),
    ...common,
  })
  .refine((record) => (record.mode !== null) === (record.relationType === 'makes_binding'), {
    message: 'mode is set for a makes_binding relation and only for it',
    path: ['mode'],
  })
  .refine((record) => record.relationType !== 'deviates_from' || record.anchors.length > 0, {
    message: 'a deviates_from names the clauses it displaces',
    path: ['anchors'],
  })
  .refine((record) => !(record.from.type === record.to.type && record.from.key === record.to.key), {
    message: 'a relation joins two different instruments',
    path: ['to'],
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

/** A public source (ADR-0174): its key is the source id the fetcher, captures and monitors name. */
const sourceRecord = z.object({
  type: z.literal('source'),
  ...sourceRecordFields,
  ...common,
})

export const proposedRecordSchema = z.discriminatedUnion('type', [
  workRecord,
  editionRecord,
  manifestationRecord,
  territoryRecord,
  authorityRecord,
  rulesetRecord,
  relationRecord,
  sourceRecord,
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

/** One record of a proposal: what became of it, and its problems (RFC 9457 members with a JSON Pointer into it). */
export interface ProposalRecordResult {
  index: number
  key: string
  recordId: string
  /** valid (dry run, no problems), invalid, written (a new revision), unchanged (the same proposal is already the request's newest). */
  status: 'valid' | 'invalid' | 'written' | 'unchanged'
  revisionId: string | null
  problems: KitProblemView[]
}

/** A problem of the validation kit as the wire carries it (`validate.ts`). */
export interface KitProblemView {
  type: string
  code: string
  key: string
  recordId: string
  pointer: string
  detail: string
  hint: string
  index?: number
}

export interface ProposalView {
  dryRun: boolean
  /** No record has a problem. A batch with one is refused (422) unless it is a dry run, and nothing of it is written. */
  valid: boolean
  results: ProposalRecordResult[]
}

export interface ValidationView {
  changeRequestId: string
  /** Every record the request holds passes the kit: it may be submitted. */
  valid: boolean
  records: number
  checks: readonly string[]
  problems: KitProblemView[]
}

/** The most text a capture keeps: the Bauordnung für Wien is 760k characters, the ABGB 970k. */
export const MAX_CAPTURE_TEXT_CHARS = 2_000_000

/** A configured public source's id (`configs/sources/<country>/<name>`): `at-ris`, `ch-fedlex`. */
export const sourceIdSchema = z.string().trim().regex(/^[a-z]{2}-[a-z0-9-]{1,60}$/, 'a configured source id such as at-ris')

export const captureBodySchema = z.discriminatedUnion('basis', [
  z.object({
    basis: z.literal('fetched'),
    sourceId: sourceIdSchema.describe('The configured public source whose hosts the page is on, e.g. "at-ris".'),
    url: z.url().max(2000).describe('The page to capture; fetched through the public-source fetcher, GET only.'),
  }),
  z.object({
    basis: z.literal('operator_supplied'),
    url: z.url().max(2000).describe('Where the text was taken from, for the reviewer to check it against.'),
    text: z.string().min(1).max(MAX_CAPTURE_TEXT_CHARS).describe('The page’s text as you copied it from the source.'),
    note: z.string().trim().min(1).max(500).optional().describe('Why it was not fetched, e.g. the portal needs a browser.'),
  }),
])
export type CaptureBody = z.infer<typeof captureBodySchema>

export interface CaptureView {
  captureId: string
  changeRequestId: string
  basis: 'fetched' | 'operator_supplied'
  sourceId: string | null
  url: string
  finalUrl: string | null
  contentType: string | null
  sha256: string
  bytes: number
  /** Characters of text kept for the quote check; 0 when the capture holds none. */
  textChars: number
  retrievedAt: string
}

/** The record types `platform-knowledge-schema-get` describes. */
export const PROPOSED_RECORD_TYPES = ['territory', 'authority', 'work', 'edition', 'manifestation', 'ruleset', 'source'] as const

export const schemaQuerySchema = z.object({
  type: z.enum(PROPOSED_RECORD_TYPES).optional().describe('One record type; all of them when absent.'),
})

export const territoryImportBodySchema = z.object({
  format: z.enum(['iso3166']).describe('A bulk file of ISO 3166 rows.'),
  captureId: captureIdSchema.describe('The capture of the list the rows come from; each row’s name is checked against it (KC-6).'),
  rows: z
    .array(
      z.object({
        code: territoryIdSchema,
        name: z.string().trim().min(1).max(200),
        parent: territoryIdSchema.optional(),
        quote: z
          .string()
          .trim()
          .min(2)
          .max(2000)
          .optional()
          .describe('Words of the captured list that name this row, at least three; "<code> <name>" when absent.'),
      }),
    )
    .min(1)
    .max(MAX_PROPOSED_RECORDS),
  dryRun: z.boolean().default(false).describe('Validate only; nothing is written.'),
})

export const reviewBodySchema = z.object({
  decisions: z
    .array(
      z.object({
        revisionId: z.uuid(),
        claimPath: z.string().trim().min(1).max(120),
        decision: z.enum(REVIEW_DECISIONS),
        note: z.string().trim().min(1).max(2000).optional(),
        sourceChecked: z
          .boolean()
          .default(false)
          .describe('You checked the cited capture against its source; required before approving a record that cites an operator-supplied capture.'),
      }),
    )
    .min(1)
    .max(500),
})

/** The shortest reason an override takes: a sentence somebody can follow up, not a word (ADR-0176). */
export const MIN_OVERRIDE_REASON = 20

export const approvalBodySchema = z.object({
  decision: z
    .enum(['approve', 'reject'])
    .describe('On a request whose second review is due (secondReview.state due, past submitted): approve confirms it, reject disputes it.'),
  role: z.enum(APPROVAL_ROLES).default('domain_expert'),
  override: z
    .object({
      reason: z
        .string()
        .trim()
        .min(MIN_OVERRIDE_REASON)
        .max(500)
        .describe('Why nobody else can approve now; kept on the approval and in the audit trail.'),
    })
    .optional()
    .describe(
      'Approve a request you wrote without a second person (needs platform:knowledge:approve_alone and the person\'s own yes). Never implicit: the request is marked approval single and a second review stays due until another person gives it.',
    ),
})
export type ApprovalBody = z.input<typeof approvalBodySchema>

export const publishBodySchema = z.object({
  channel: z.enum(RELEASE_CHANNELS).describe('preview first; stable moves what offices read.'),
})

export type ReleaseChannelBody = z.infer<typeof publishBodySchema>
/** A review as the service takes it: `sourceChecked` may be left out (false). */
export type ReviewDecisionBody = z.input<typeof reviewBodySchema>

export const rollbackBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000),
})

/** A page of change requests: the default and the most one call returns. */
export const CHANGE_REQUEST_PAGE = 50
export const MAX_CHANGE_REQUEST_PAGE = 200

export const listChangeRequestsQuerySchema = z.object({
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
  origin: z
    .enum(CHANGE_REQUEST_ORIGINS)
    .optional()
    .describe('monitor: the requests a source monitor opened because its source changed (ADR-0174).'),
  limit: z.coerce.number().int().min(1).max(MAX_CHANGE_REQUEST_PAGE).optional(),
  secondReview: z
    .enum(SECOND_REVIEW_STATES)
    .optional()
    .describe('due: the requests approved alone whose second review nobody has given yet (ADR-0176).'),
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
  citations: Citation[]
  claims: ClaimView[]
}

export interface ChangeRequestView extends Omit<ChangeRequestSummary, 'revisionCount'> {
  submittedAt: string | null
  publishedAt: string | null
  revisions: RevisionView[]
  /** The pages the records cite, as captured (ADR-0170); their text stays on the server. */
  captures: CaptureView[]
  /** `overrideReason` is set on an author's own approval through the override (ADR-0176). */
  approvals: { approver: string; role: string; decisionSource: string; decidedAt: string; overrideReason: string | null }[]
  releases: {
    seq: number
    recordId: string
    channel: string
    action: string
    toRevisionId: string | null
    releasedAt: string
    approval: ChangeRequestApproval
  }[]
}

export interface ChangeRequestSummary {
  id: string
  title: string
  countryId: string
  status: (typeof CHANGE_REQUEST_STATUSES)[number]
  createdBy: string
  createdAt: string
  revisionCount: number
  /** operator, or monitor: a source monitor found its source changed (ADR-0174). */
  origin: (typeof CHANGE_REQUEST_ORIGINS)[number]
  /** The source a monitor's request is about; null for an operator's. */
  sourceRecordId: string | null
  /** What the monitor found: the previous and current etag, sha256 and version, the terms, and needs[]. */
  monitorFinding: Record<string, unknown> | null
  /** four_eyes, or single: its author approved it alone through the override, and a second review is owed (ADR-0176). */
  approval: ChangeRequestApproval
  /** The review a single approval owes; null on a four-eyes request. */
  secondReview: { state: SecondReviewState; by: string | null; at: string | null } | null
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

/** Why an office has no home country (ADR-0158): no row yet (its first page load writes one), or nobody stated it. */
export const UNPLACED_REASONS = ['no_row', 'no_row_directory_names', 'not_stated'] as const

/** One office's placement as the platform reads it: `platform-org-countries-list`. */
export interface OrganizationPlacementView {
  organizationId: string
  name: string
  homeCountry: string | null
  /** Null once placed. `directoryHomeCountry`: what the WorkOS organization's metadata names, if anything. */
  unplaced: { reason: (typeof UNPLACED_REASONS)[number]; directoryHomeCountry: string | null } | null
  /** Its home first (source `home`), then each country the platform entitled it to, with who and how. */
  entitled: {
    countryId: string
    source: 'home' | 'platform'
    entitledAt: string | null
    entitledBy: string | null
    decisionSource: string | null
  }[]
}

export interface PlatformOrganizationCountries {
  /** This page's offices, the unplaced first, then by name. */
  organizations: OrganizationPlacementView[]
  /** How many on this page have no home country. */
  unplaced: number
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null
}

export const listOrganizationCountriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().describe('Organizations per page; 100 at most and by default.'),
  cursor: z.string().trim().min(1).max(200).optional().describe('nextCursor of the previous page.'),
})
