/**
 * The wire of the office's base knowledge (ADR-0163): the entry a person or an
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
  LICENCE_CLASSES,
  OFFICE_WORK_KINDS,
  type KnowledgeCheckResult,
} from '@/lib/base-knowledge/wire/vocab'

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
    .enum(OFFICE_WORK_KINDS)
    .describe('A commentary only interprets.'),
  title: z.string().trim().min(1).max(300).describe('The title as the document prints it.'),
  designation: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullable()
    .describe('e.g. "ÖNORM B 1600:2017".'),
  editionLabel: z.string().trim().min(1).max(120).describe('The edition as the masthead prints it, e.g. "2017-04-01".'),
  issuedOn: isoDate.nullable(),
  inForceFrom: isoDate.nullable().describe('When this edition took effect; null: from issuedOn.'),
  inForceTo: isoDate.nullable().describe('When it stopped applying, if withdrawn; a later edition ends it by itself.'),
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
      .describe('Needed for a licensed copy: the licence covers the whole office.'),
    aiProcessingAttested: z
      .boolean()
      .optional()
      .describe('The licence covers hosted AI processing; else a licensed copy is metadata-only.'),
  })
  .strict()
export type ConfirmEntryBody = z.infer<typeof confirmEntryBodySchema>

/**
 * A change to a confirmed entry's descriptive values. The licence class and the
 * office's statements are not among them: they decide whether the text reaches
 * a model, so they change only through `licenceEntryBodySchema`, the person's
 * own call (ADR-0163).
 */
export const updateEntryBodySchema = entryValuesSchema.omit({ licenceClass: true }).partial().strict()
export type UpdateEntryBody = z.infer<typeof updateEntryBodySchema>

/** A change to a confirmed copy's licence: its class, and the office's statements on it. */
export const licenceEntryBodySchema = confirmEntryBodySchema
  .pick({ licenceClass: true, licenceAttested: true, aiProcessingAttested: true })
  .strict()
export type LicenceEntryBody = z.infer<typeof licenceEntryBodySchema>

export const recordCheckBodySchema = z
  .object({
    result: z.enum(KNOWLEDGE_CHECK_RESULTS).describe('current: still the edition in force.'),
    note: z.string().trim().max(1000).optional().describe('Where it was checked.'),
  })
  .strict()
export type RecordCheckBody = z.infer<typeof recordCheckBodySchema>

/** What needs somebody's attention: a proposal to confirm, a check due, a copy whose text is not used. */
export const ENTRY_ATTENTION = ['proposed', 'check_due', 'metadata_only'] as const
export type EntryAttention = (typeof ENTRY_ATTENTION)[number]

export const listEntriesQuerySchema = z
  .object({
    status: z.enum(['proposed', 'confirmed']).optional(),
    designation: z.string().trim().min(1).max(120).optional().describe('Part of a designation or title.'),
    q: z.string().trim().min(1).max(120).optional().describe('Part of a designation, title or file name.'),
    kind: z.enum(OFFICE_WORK_KINDS).optional(),
    attention: z
      .enum(ENTRY_ATTENTION)
      .optional()
      .describe('proposed: to confirm; check_due: never checked, overdue or last found not current; metadata_only: text not used.'),
    folderId: z
      .guid()
      .optional()
      .describe('A folder from base-knowledge-folder-list: its entries and those of its subfolders.'),
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

/** One confirmed entry among the editions of its standard the office holds. */
export interface EditionStanding {
  /** Kind and designation without its edition (or title): what makes editions one standard. */
  seriesKey: string
  /** How many confirmed editions of it the office holds. */
  editions: number
  /** The edition in force today; the turn picks by the project's reference date instead. */
  inForce: boolean
  /** The entry of the next edition, when one followed this. */
  supersededBy: string | null
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
  /**
   * `metadata_only` for a licensed copy until the office states that its licence
   * covers processing by the hosted AI services: its text is not indexed, read
   * or quoted, and answers say the office holds it but its text is not used.
   */
  textUse: 'used' | 'metadata_only'
  /** When the office stated that, or null. */
  aiProcessingAttestedAt: string | null
  /** Who suggested the entry: the masthead reading, an agent or a person. Confirming keeps it. */
  proposedBy: 'reading' | 'agent' | 'person'
  /** The user who confirmed the values in force, or last changed them; null while proposed or for an entry confirmed before this was kept. */
  confirmedBy: string | null
  freshness: Freshness
  /** Where it stands among the office's editions of the same standard (`office/editions.ts`); null for a proposal. */
  edition: EditionStanding | null
  /** The office shelf folder its document is filed in; null at the shelf root. */
  folderId: string | null
  /** The display name of `confirmedBy`; null when nobody confirmed or the directory cannot be read. */
  confirmedByName: string | null
  createdAt: string
}

/** How many entries, in the folder asked for (all folders without one), need what. */
export interface EntryCounts {
  all: number
  proposed: number
  checkDue: number
  metadataOnly: number
}

export interface BaseKnowledgeList {
  canManage: boolean
  /** Before `attention`, `kind` and `q` narrow the page, so a filter can show what it would find. */
  counts: EntryCounts
  /**
   * Where an entry can apply, to pick from rather than type: the office's
   * countries (label null: the client names a country by its locale) and the
   * subdivisions its records name, with their labels.
   */
  territories: { id: string; label: string | null }[]
  /** Entries filed directly in each office shelf folder, over every entry the reader sees: what a folder tile holds. */
  folderCounts: Record<string, number>
  entries: BaseKnowledgeEntry[]
  /** Where the next page starts, or null on the last page. */
  nextCursor: string | null
}

/** A folder of the office's base knowledge: the standards root's subtree on the office shelf. */
export interface BaseKnowledgeFolder {
  id: string
  parentId: string | null
  name: string
  /** The folder's path on the office shelf, root first. */
  path: string
  description: string | null
}

export interface BaseKnowledgeFolders {
  /** The standards root folder; null until the first upload or folder creates it. */
  rootId: string | null
  /** The folders below the root on this page, by path. */
  folders: BaseKnowledgeFolder[]
  /** Where the next page starts, or null on the last page. */
  nextCursor: string | null
}

/** A page of folders: the default and the most one call returns. */
export const FOLDER_PAGE = 200

export const listFoldersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(FOLDER_PAGE).default(FOLDER_PAGE).describe(`Default and max ${FOLDER_PAGE}.`),
    cursor: z.string().regex(/^\d{1,5}$/).optional().describe('The previous page’s `nextCursor`.'),
  })
  .strict()
export type ListFoldersQuery = z.infer<typeof listFoldersQuerySchema>

export const createFolderBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).describe('e.g. a trade, a topic or a standards body.'),
    parentId: z.guid().optional().describe('A folder from base-knowledge-folder-list; omit for the top level.'),
    description: z.string().trim().max(500).optional().describe('What belongs in it, in the office’s words.'),
  })
  .strict()
export type CreateFolderBody = z.infer<typeof createFolderBodySchema>

/** The most entries one bulk call changes; the rest is a second call. */
export const MAX_BULK_ENTRIES = 50

export const bulkEntriesBodySchema = z
  .object({
    entryIds: z.array(z.string().min(1).max(120)).min(1).max(MAX_BULK_ENTRIES).describe(`From base-knowledge-list; at most ${MAX_BULK_ENTRIES}.`),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('check'), result: recordCheckBodySchema.shape.result, note: recordCheckBodySchema.shape.note }).strict(),
      z.object({ type: z.literal('move'), folderId: z.guid().describe('From base-knowledge-folder-list.') }).strict(),
      z.object({ type: z.literal('remove') }).strict(),
    ]),
  })
  .strict()
export type BulkEntriesBody = z.infer<typeof bulkEntriesBodySchema>

export interface BulkEntryResult {
  entryId: string
  ok: boolean
  /** Why this one was refused; the others still ran. */
  error: string | null
}

export interface BulkEntriesResult {
  results: BulkEntryResult[]
}
