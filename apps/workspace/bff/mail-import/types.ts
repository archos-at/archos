import { z } from 'zod'
import type { MailImportErrorCode, MailImportSkippedSample, MailImportStatus } from '@/lib/db/schema/mail-imports'
import { decodeDocumentListCursor, DOCUMENT_LIST_CURSOR_MAX_LENGTH } from '@/lib/documents/list-cursor'

export const startMailImportSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
})
export type StartMailImportInput = z.infer<typeof startMailImportSchema>

export const MAIL_IMPORT_LIST_PAGE_SIZE = 20
export const MAIL_IMPORT_LIST_PAGE_MAX = 50

export const mailImportListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAIL_IMPORT_LIST_PAGE_MAX)
    .optional()
    .describe(`Default ${MAIL_IMPORT_LIST_PAGE_SIZE}, max ${MAIL_IMPORT_LIST_PAGE_MAX}.`),
  cursor: z
    .string()
    .max(DOCUMENT_LIST_CURSOR_MAX_LENGTH)
    .refine((value) => decodeDocumentListCursor(value) !== null, { message: 'Invalid cursor' })
    .optional()
    .describe('The nextCursor of the previous page.'),
})
export type MailImportListQuery = z.infer<typeof mailImportListQuerySchema>

export interface MailImportView {
  id: string
  filename: string
  sizeBytes: number
  status: MailImportStatus
  startedBy: { userId: string; email: string | null }
  ownedByViewer: boolean
  cancellable: boolean
  folderId: string | null
  totalItems: number | null
  processedItems: number
  mailsFiled: number
  filesFiled: number
  itemsSkipped: number
  filesSkipped: number
  threadsCreated: number
  threadsAppended: number
  alreadyInProject: number
  skippedSamples: MailImportSkippedSample[]
  errorCode: MailImportErrorCode | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

export interface MailImportUploadPlan {
  import: MailImportView
  partSize: number
  partCount: number
  uploadedParts: number[]
}

export interface MailImportList {
  imports: MailImportView[]
  nextCursor: string | null
  maxSizeBytes: number
  partSize: number
}
