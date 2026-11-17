import { z } from 'zod'
import { FOLDER_CARD_STATUSES } from '@/lib/folder-cards/types'

export const ESTATE_SHELVES = ['project', 'office_shelf', 'session'] as const
export type EstateShelf = (typeof ESTATE_SHELVES)[number]

export const ESTATE_TREE_PAGE_MAX = 500
export const ESTATE_TREE_PAGE_DEFAULT = 200

export const ESTATE_TREE_FOLDERS_MAX = 1000

const CURSOR_MAX = 1024

export const estateTreeRequestSchema = z
  .object({
    shelf: z.enum(ESTATE_SHELVES),
    folder_path: z.string().min(1).max(1024).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
    limit: z.number().int().min(1).max(ESTATE_TREE_PAGE_MAX).optional(),
  })
  .strict()
export type EstateTreeRequest = z.infer<typeof estateTreeRequestSchema>

export const estateTreeFolderSchema = z.object({
  id: z.guid(),
  parent_id: z.guid().nullable(),
  name: z.string(),
  path: z.string(),
  description: z.string().nullable(),
  card: z.object({ status: z.enum(FOLDER_CARD_STATUSES), generated_at: z.string().nullable() }).nullable(),
})
export type EstateTreeFolder = z.infer<typeof estateTreeFolderSchema>

export const estateTreeDocumentSchema = z.object({
  id: z.guid(),
  filename: z.string(),
  display_name: z.string().nullable(),
  folder_id: z.guid().nullable(),
  folder_path: z.string().nullable(),
  collection: z.string(),
  content_type: z.string().nullable(),
  file_size: z.number().int().nullable(),
  status: z.string(),
  authored_by: z.string(),
  document_type: z.string().nullable(),
  page_count: z.number().int().nullable(),
  superseded: z.boolean(),
  plan_number: z.string().nullable(),
  plan_index: z.string().nullable(),
  plan_date: z.string().nullable(),
  published_version: z.number().int().nullable(),
  version_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type EstateTreeDocument = z.infer<typeof estateTreeDocumentSchema>

export const estateTreeResponseSchema = z.object({
  shelf: z.enum(ESTATE_SHELVES),
  collection: z.string(),
  folders: z.array(estateTreeFolderSchema),
  folders_truncated: z.boolean(),
  documents: z.array(estateTreeDocumentSchema),
  next_cursor: z.string().nullable(),
})
export type EstateTreeResponse = z.infer<typeof estateTreeResponseSchema>

export const ESTATE_TREE_WIRE_SCHEMAS = {
  EstateTreeRequest: estateTreeRequestSchema,
  EstateTreeFolder: estateTreeFolderSchema,
  EstateTreeDocument: estateTreeDocumentSchema,
  EstateTreeResponse: estateTreeResponseSchema,
} as const
