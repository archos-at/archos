import { z } from 'zod'
import {
  KNOWLEDGE_CHECK_RESULTS,
  LICENCE_CLASSES,
  OFFICE_WORK_KINDS,
  type KnowledgeCheckResult,
  type OfficeWorkKind,
} from '@/lib/base-knowledge/wire/vocab'

const territoryId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'an ISO 3166 code such as AT or AT-9')

const isoDate = z.iso.date()

export const ASK_FOR_LICENCE = false

export const UNKNOWN_EDITION = 'unbekannt'

export const ENTRY_PAGE = 50
export const MAX_ENTRY_PAGE = 200

export const addresseeSchema = z.object({
  name: z.string().trim().min(1).max(120).describe('e.g. "MA 37".'),
  territoryId: territoryId.describe('Where it decides, e.g. AT-9.'),
})

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

export const updateEntryBodySchema = entryValuesSchema.omit({ licenceClass: true }).partial().strict()
export type UpdateEntryBody = z.infer<typeof updateEntryBodySchema>

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

export interface Freshness {
  intervalDays: number
  lastCheck: EntryCheck | null
  dueAt: string | null
  overdue: boolean
}

export interface EntryEdition {
  id: string
  editionLabel: string
  startsOn: string | null
  status: 'proposed' | 'confirmed'
  inForceToday: boolean
}

export interface BaseKnowledgeEntry {
  id: string
  editionId: string
  copyId: string
  documentId: string
  fileName: string
  status: 'proposed' | 'confirmed'
  values: EntryValues
  textUse: 'used' | 'metadata_only'
  aiProcessingAttestedAt: string | null
  proposedBy: 'reading' | 'agent' | 'person'
  confirmedBy: string | null
  freshness: Freshness
  workId: string
  editions: EntryEdition[]
  folderId: string | null
  confirmedByName: string | null
  createdAt: string
}

export interface EntryCounts {
  all: number
  proposed: number
  checkDue: number
  metadataOnly: number
}

export interface BaseKnowledgeList {
  canManage: boolean
  counts: EntryCounts
  territories: { id: string; label: string | null }[]
  folderCounts: Record<string, number>
  entries: BaseKnowledgeEntry[]
  nextCursor: string | null
}

export interface BaseKnowledgeFolder {
  id: string
  parentId: string | null
  name: string
  path: string
  description: string | null
}

export interface BaseKnowledgeFolders {
  rootId: string | null
  folders: BaseKnowledgeFolder[]
  nextCursor: string | null
}

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
  error: string | null
}

export interface BulkEntriesResult {
  results: BulkEntryResult[]
}

export const MAX_RECOGNIZE_DOCUMENTS = 50

export const recognizeBodySchema = z
  .object({
    documentIds: z
      .array(z.guid())
      .min(1)
      .max(MAX_RECOGNIZE_DOCUMENTS)
      .describe(`Office shelf documents, from document-list; at most ${MAX_RECOGNIZE_DOCUMENTS}.`),
    asNorm: z.boolean().optional().describe('true: propose each document even when its reading finds no norm.'),
  })
  .strict()
export type RecognizeBody = z.infer<typeof recognizeBodySchema>

export interface NormProposal {
  entryId: string
  documentId: string
  fileName: string
  kind: OfficeWorkKind
  designation: string | null
  editionLabel: string | null
  topicId: string | null
  editionOf: { entryId: string; designation: string | null; editionLabel: string } | null
  duplicate: boolean
}

export interface PlainUpload {
  documentId: string
  fileName: string
  folderId: string | null
  folderPath: string | null
  platformHeld: boolean
}

export interface NormRecognition {
  proposals: NormProposal[]
  plain: PlainUpload[]
  topics: BaseKnowledgeFolders
}

export const settleProposalsBodySchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            entryId: z.string().min(1).max(120).describe('A proposal from base-knowledge-recognize.'),
            notNorm: z.boolean().optional().describe('true: drop the proposal; the file stays where it lies, an ordinary file.'),
            kind: entryFields.kind.optional(),
            designation: entryFields.designation.optional(),
            editionLabel: z
              .string()
              .trim()
              .max(120)
              .nullable()
              .optional()
              .describe('Empty or null: the edition is missing and the row stays a proposal; omit to keep the read one.'),
            topicId: z
              .guid()
              .nullable()
              .optional()
              .describe('A folder from base-knowledge-folder-list; null for the base-knowledge root. A new edition goes to its work’s folder.'),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_RECOGNIZE_DOCUMENTS),
  })
  .strict()
export type SettleProposalsBody = z.infer<typeof settleProposalsBodySchema>

export type SettleOutcome = 'confirmed' | 'edition_added' | 'duplicate_removed' | 'not_norm' | 'edition_missing' | 'failed'

export interface SettledProposal {
  entryId: string
  outcome: SettleOutcome
  error: string | null
}

export interface SettleProposalsResult {
  results: SettledProposal[]
}

export interface BaseKnowledgeUnlisting {
  documentId: string
  folderId: null
}
