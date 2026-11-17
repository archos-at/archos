import { z } from 'zod'
import { UPLOAD_BATCH_SCOPES } from '@/lib/db/schema/upload-batches'
import { documentListCursorParam } from '@/lib/documents/list-cursor'

export const UPLOAD_BATCH_MAX_FILES = 10_000

export const uploadBatchExclusionsSchema = z
  .array(
    z.object({ term: z.string().trim().min(1).max(80), count: z.number().int().min(1).max(UPLOAD_BATCH_MAX_FILES) }).strict()
  )
  .max(200)
  .default([])

export const openUploadBatchSchema = z
  .object({
    id: z.guid(),
    scope: z.preprocess((value) => (value === 'archiv' ? 'office_shelf' : value), z.enum(UPLOAD_BATCH_SCOPES)),
    projectId: z.guid().nullable().default(null),
    conversationId: z.string().min(1).max(200).nullable().default(null),
    expectedCount: z.number().int().min(0).max(UPLOAD_BATCH_MAX_FILES),
    excluded: uploadBatchExclusionsSchema,
  })
  .strict()

export const sealUploadBatchSchema = z
  .object({
    unchanged: z.number().int().min(0).max(UPLOAD_BATCH_MAX_FILES),
    failed: z.number().int().min(0).max(UPLOAD_BATCH_MAX_FILES),
    excluded: uploadBatchExclusionsSchema,
  })
  .strict()

export const uploadHistoryQuerySchema = z.object({ cursor: documentListCursorParam })
