import { z } from 'zod'
import { MAX_ROOT_SORT_DOCUMENTS } from './root-sort-types'

export const keptMoveSchema = z.object({
  documentId: z.guid(),
  folderId: z.guid().nullable(),
  newFolderPath: z.string().min(1).max(1024).nullable(),
})
export type KeptMove = z.infer<typeof keptMoveSchema>

export const applyRootSortRequestSchema = z.object({
  keep: z.array(keptMoveSchema).min(1).max(MAX_ROOT_SORT_DOCUMENTS),
})
export type ApplyRootSortRequest = z.infer<typeof applyRootSortRequestSchema>
