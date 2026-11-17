import { z } from 'zod'

export const folderListQuerySchema = z.object({
  counts: z
    .literal('true')
    .optional()
    .describe('Adds `documentCount` (filed directly in it) per folder.'),
})

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.guid().nullable().optional(),
})

export const updateFolderSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    parentId: z.guid().nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined || body.description !== undefined, {
    message: 'Nothing to update.',
  })

export const ensureFoldersSchema = z.object({
  parentId: z.guid().nullable().optional(),
  paths: z.array(z.string().min(1).max(4096)).max(300),
})
