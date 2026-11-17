import { z } from 'zod'
import { decodeDocumentListCursor } from '@/lib/documents/list-cursor'

export const BIN_PAGE_SIZE = 50
export const BIN_PAGE_MAX = 200

export const binListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BIN_PAGE_MAX)
    .optional(),
  cursor: z
    .string()
    .max(200)
    .refine((value) => decodeDocumentListCursor(value) !== null, { message: 'Invalid cursor' })
    .optional(),
})
export type BinListQuery = z.infer<typeof binListQuerySchema>

export const binEntrySchema = z.object({
  folderId: z.string(),
  name: z.string(),
  path: z.string(),
  deletedAt: z.string(),
  deletedBy: z.object({ userId: z.string().nullable(), name: z.string().nullable() }),
  purgeAfter: z.string(),
  status: z.string(),
  documents: z.number(),
  folders: z.number(),
  canRestore: z.boolean(),
  restoreBlocked: z.enum(['folder_read_only', 'project_closed', 'no_write']).nullable().optional(),
  document: z.object({ id: z.string(), name: z.string() }).nullable(),
})
export type BinEntryWire = z.infer<typeof binEntrySchema>

export const binListingSchema = z.object({
  entries: z.array(binEntrySchema),
  canPurge: z.boolean(),
  nextCursor: z.string().nullable(),
})
export type BinListingWire = z.infer<typeof binListingSchema>

export const documentBinResultSchema = z.object({
  documentId: z.string(),
  binEntryId: z.string(),
  purgeAfter: z.string(),
})
export type DocumentBinResult = z.infer<typeof documentBinResultSchema>

export const documentRestoreResultSchema = z.object({
  documentId: z.string(),
  folderId: z.string().nullable(),
  restoredTo: z.enum(['original', 'root']),
})
export type DocumentRestoreResult = z.infer<typeof documentRestoreResultSchema>

export const BINNED_WITH_FOLDER_REASON = 'binned-with-folder'
export const DOCUMENT_HAS_NO_BIN_REASON = 'document-has-no-bin'
