import { z } from 'zod'

export const FOLDER_CARD_ABSTRACT_MAX = 600
export const FOLDER_CARD_KEY_FACTS_MAX = 8
export const FOLDER_CARD_STATUSES = ['fresh', 'stale', 'failed'] as const

export const folderCardKeyFactSchema = z
  .object({
    statement: z.string().min(1).max(300),
    documents: z.array(z.string().min(1).max(255)).min(1).max(8),
    pages: z.string().min(1).max(40).optional(),
  })
  .strict()
export type FolderCardKeyFact = z.infer<typeof folderCardKeyFactSchema>

export const putFolderCardRequestSchema = z
  .object({
    organization_id: z.string().min(1),
    collection: z.string().min(1),
    folder_path: z.string().min(1).max(1024),
    abstract: z.string().max(FOLDER_CARD_ABSTRACT_MAX).nullable(),
    key_facts: z.array(folderCardKeyFactSchema).max(FOLDER_CARD_KEY_FACTS_MAX),
    input_hash: z.string().min(1).max(128),
    abstract_hash: z.string().min(1).max(128).nullable(),
    model: z.string().min(1).max(200).nullable(),
    prompt_version: z.string().min(1).max(100).nullable(),
    status: z.enum(FOLDER_CARD_STATUSES),
  })
  .strict()
export type PutFolderCardRequest = z.infer<typeof putFolderCardRequestSchema>

export const getFolderCardsQuerySchema = z
  .object({ organization_id: z.string().min(1), collection: z.string().min(1) })
  .strict()

export const deleteFolderCardQuerySchema = getFolderCardsQuerySchema.extend({
  folder_path: z.string().min(1).max(1024),
})

export const folderCardViewSchema = z.object({
  folder_id: z.guid(),
  folder_path: z.string(),
  folder_description: z.string().nullable(),
  collection: z.string(),
  abstract: z.string().nullable(),
  key_facts: z.array(folderCardKeyFactSchema),
  input_hash: z.string(),
  abstract_hash: z.string().nullable(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  status: z.enum(FOLDER_CARD_STATUSES),
  generated_at: z.string().nullable(),
  updated_at: z.string(),
})
export type FolderCardView = z.infer<typeof folderCardViewSchema>

export const folderDescriptionViewSchema = z.object({
  folder_id: z.guid(),
  folder_path: z.string(),
  folder_description: z.string().nullable(),
})
export type FolderDescriptionView = z.infer<typeof folderDescriptionViewSchema>

export const putFolderCardResponseSchema = z.object({ folder_id: z.guid(), status: z.enum(FOLDER_CARD_STATUSES) })
export type PutFolderCardResponse = z.infer<typeof putFolderCardResponseSchema>

export const getFolderCardsResponseSchema = z.object({
  cards: z.array(folderCardViewSchema),
  folders: z.array(folderDescriptionViewSchema),
})
export type GetFolderCardsResponse = z.infer<typeof getFolderCardsResponseSchema>

export const deleteFolderCardResponseSchema = z.object({ deleted: z.boolean() })

export const FOLDER_CARD_WIRE_SCHEMAS = {
  PutFolderCardRequest: putFolderCardRequestSchema,
  PutFolderCardResponse: putFolderCardResponseSchema,
  FolderCardView: folderCardViewSchema,
  FolderDescriptionView: folderDescriptionViewSchema,
  GetFolderCardsResponse: getFolderCardsResponseSchema,
} as const
