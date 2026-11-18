import { z } from 'zod'
import { verdictSchema } from '@/lib/upload-screening/quarantine'

const QuarantineFieldSchema = verdictSchema.nullable().catch(null).optional()

export const DocumentFileStatusSchema = z.enum(['uploading', 'ingesting', 'success', 'failed'])

export const ListedFileStatusSchema = z.enum([
  ...DocumentFileStatusSchema.options,
  'stored',
  'held',
])

export const JobStateSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])

export const CollectionInfoSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  file_count: z.number(),
  chunk_count: z.number(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  backend: z.string(),
  metadata: z.record(z.string(), z.unknown()),
})

export const FileInfoSchema = z.object({
  file_id: z.string(),
  file_name: z.string(),
  collection_name: z.string(),
  status: ListedFileStatusSchema,
  file_size: z.number().nullable().optional(),
  chunk_count: z.number(),
  uploaded_at: z.string().nullable().optional(),
  ingested_at: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  quarantine: QuarantineFieldSchema,
  metadata: z.record(z.string(), z.unknown()),
})

export const FileListResponseSchema = z.object({
  files: z.array(FileInfoSchema),
})

export const UploadResponseSchema = z.object({
  job_id: z.string(),
  file_ids: z.array(z.string()),
  message: z.string().optional(),
})

export const FileProgressSchema = z.object({
  file_id: z.string(),
  file_name: z.string(),
  status: DocumentFileStatusSchema,
  progress_percent: z.number(),
  error_message: z.string().nullable().optional(),
  quarantine: QuarantineFieldSchema,
  chunks_created: z.number().optional(),
})

export const IngestionJobStatusSchema = z.object({
  job_id: z.string(),
  status: JobStateSchema,
  submitted_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  total_files: z.number(),
  processed_files: z.number(),
  file_details: z.array(FileProgressSchema),
  collection_name: z.string(),
  backend: z.string(),
  error_message: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
})

export type DocumentFileStatus = z.infer<typeof DocumentFileStatusSchema>
export type ListedFileStatus = z.infer<typeof ListedFileStatusSchema>
export type JobState = z.infer<typeof JobStateSchema>
export type CollectionInfo = z.infer<typeof CollectionInfoSchema>
export type FileInfo = z.infer<typeof FileInfoSchema>
export type FileListResponse = z.infer<typeof FileListResponseSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>
export type FileProgress = z.infer<typeof FileProgressSchema>
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>
