import { z } from 'zod'

export const documentBinResultSchema = z.object({
  documentId: z.string(),
  binEntryId: z.string(),
  purgeAfter: z.string(),
})
export type DocumentBinResult = z.infer<typeof documentBinResultSchema>
