import { z } from 'zod'

export const FOLDER_NORMS_PER_REQUEST = 50
export const FOLDER_NORMS_PAGE = 100

export const folderNormsParamsSchema = z.object({
  folderId: z.guid().describe('An office shelf folder id, from office-shelf-folder-list.'),
})
export type FolderNormsParams = z.infer<typeof folderNormsParamsSchema>

export const listFolderNormsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(FOLDER_NORMS_PAGE)
      .default(FOLDER_NORMS_PAGE)
      .describe(`Default and max ${FOLDER_NORMS_PAGE}.`),
    cursor: z.string().regex(/^\d{1,4}$/).optional().describe('The previous page’s `nextCursor`.'),
  })
  .strict()
export type ListFolderNormsQuery = z.infer<typeof listFolderNormsQuerySchema>

export const decideFolderNormsBodySchema = z
  .object({
    action: z
      .enum(['record', 'keep'])
      .describe('`record`: proposed as base knowledge, moved to its root. `keep`: ordinary files, never offered again.'),
  })
  .strict()
export type DecideFolderNormsBody = z.infer<typeof decideFolderNormsBodySchema>

export const folderNormSchema = z.object({
  documentId: z.string(),
  fileName: z.string(),
  designation: z.string().nullable(),
})
export type FolderNorm = z.infer<typeof folderNormSchema>

export const folderNormsSchema = z.object({
  folderId: z.string(),
  total: z.number().int().nonnegative(),
  norms: z.array(folderNormSchema),
  nextCursor: z.string().nullable(),
})
export type FolderNorms = z.infer<typeof folderNormsSchema>

export const folderNormsDecisionSchema = z.object({
  action: z.enum(['record', 'keep']),
  done: z.array(folderNormSchema),
  failed: z.array(folderNormSchema.extend({ error: z.string() })),
  remaining: z.number().int().nonnegative(),
})
export type FolderNormsDecision = z.infer<typeof folderNormsDecisionSchema>
