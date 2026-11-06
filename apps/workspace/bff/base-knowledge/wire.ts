/**
 * The wire of the office's base knowledge (ADR-0158): the entry a person or an
 * agent reads, and the bodies that propose, confirm, edit and check one. Pure
 * zod, shared by the routes, the agent operations and the UI client.
 *
 * An entry is one held copy with its work and edition: what kind of source it
 * is, which Ausgabe, where it applies, which authority a directive binds, the
 * licence it is held under and when somebody last checked it was current.
 */

import { z } from 'zod'
import {
  KNOWLEDGE_CHECK_RESULTS,
  KNOWLEDGE_WORK_KINDS,
  LICENCE_CLASSES,
  type KnowledgeCheckResult,
} from '@/lib/base-knowledge/vocabulary'

/** ISO 3166-1 alpha-2 or 3166-2 (`AT`, `AT-9`, `DE-BY`). */
const territoryId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'an ISO 3166 code such as AT or AT-9')

const isoDate = z.iso.date()

/** A page of entries: the default and the most one call returns. */
export const ENTRY_PAGE = 50
export const MAX_ENTRY_PAGE = 200

export const addresseeSchema = z.object({
  name: z.string().trim().min(1).max(120).describe('e.g. "MA 37".'),
  territoryId: territoryId.describe('Where it decides, e.g. AT-9.'),
})

/** The values a person confirms; every field optional on a proposal, where the reading fills the rest. */
const entryFields = {
  kind: z
    .enum(KNOWLEDGE_WORK_KINDS)
    .describe('commentary only interprets; authority_directive binds where its authority decides.'),
  title: z.string().trim().min(1).max(300).describe('The title as the document prints it.'),
  designation: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullable()
    .describe('The standard designation with its year, e.g. "ÖNORM B 1600:2017"; null when none.'),
  editionLabel: z.string().trim().min(1).max(120).describe('The edition as the masthead prints it, e.g. "2017-04-01".'),
  issuedOn: isoDate.nullable(),
  territoryIds: z.array(territoryId).max(20).describe('Where it applies; empty for a standard.'),
  issuer: z.string().trim().min(1).max(200).nullable(),
  addressees: z.array(addresseeSchema).max(10).describe('A directive’s authorities; empty otherwise.'),
  licenceClass: z.enum(LICENCE_CLASSES).describe('licensed for a purchased copy.'),
}

const entryValuesSchema = z.object(entryFields)

export const proposeEntryBodySchema = entryValuesSchema
  .partial()
  .extend({ documentId: z.guid().describe('An office shelf document id, from document-list.') })
  .strict()
export type ProposeEntryBody = z.infer<typeof proposeEntryBodySchema>
export type Addressee = z.infer<typeof addresseeSchema>
export type EntryValues = z.infer<typeof entryValuesSchema>

/** A confirmation may change any proposed value; a licensed copy needs the office's attestation. */
export const confirmEntryBodySchema = entryValuesSchema
  .partial()
  .extend({
    licenceAttested: z
      .boolean()
      .optional()
      .describe('Required true for a licensed copy: its licence covers everyone in the office.'),
  })
  .strict()
export type ConfirmEntryBody = z.infer<typeof confirmEntryBodySchema>

export const updateEntryBodySchema = confirmEntryBodySchema

export const recordCheckBodySchema = z
  .object({
    result: z.enum(KNOWLEDGE_CHECK_RESULTS).describe('current: still the edition in force.'),
    note: z.string().trim().max(1000).optional().describe('Where it was checked.'),
  })
  .strict()
export type RecordCheckBody = z.infer<typeof recordCheckBodySchema>

export const listEntriesQuerySchema = z
  .object({
    status: z.enum(['proposed', 'confirmed']).optional(),
    designation: z.string().trim().min(1).max(120).optional().describe('Part of a designation or title.'),
    limit: z.coerce.number().int().min(1).max(MAX_ENTRY_PAGE).default(ENTRY_PAGE).describe(`Default ${ENTRY_PAGE}, max ${MAX_ENTRY_PAGE}.`),
    cursor: z.string().regex(/^\d{1,4}$/).optional().describe('The previous page’s `nextCursor`.'),
  })
  .strict()
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>

export const entryParamsSchema = z.object({
  entryId: z.string().min(1).max(120).describe('From base-knowledge-list.'),
})

export interface EntryCheck {
  checkedAt: string
  checkedBy: string
  result: KnowledgeCheckResult
  note: string | null
}

/** How fresh the entry's last check is. */
export interface Freshness {
  /** Days between checks for this kind (365 standards, 180 directives). */
  intervalDays: number
  lastCheck: EntryCheck | null
  /** When the next check is due; null before the first one. */
  dueAt: string | null
  /** The last check is older than the interval, or none was ever made, or it found a problem. */
  overdue: boolean
}

export interface BaseKnowledgeEntry {
  id: string
  editionId: string
  copyId: string
  documentId: string
  fileName: string
  /** `proposed` until a person confirms the values; only confirmed entries reach answers. */
  status: 'proposed' | 'confirmed'
  values: EntryValues
  /** Who suggested the values in force: the masthead reading, an agent or a person. */
  proposedBy: 'reading' | 'agent' | 'person'
  freshness: Freshness
  createdAt: string
}

export interface BaseKnowledgeList {
  /** Whether the organization uses base knowledge at all (the `office-base-knowledge` flag). */
  enabled: boolean
  canManage: boolean
  entries: BaseKnowledgeEntry[]
  /** Where the next page starts, or null on the last page. */
  nextCursor: string | null
}
