import { z } from 'zod'
import { FILENAME_LOOKUP_MAX_NAMES } from './filename-lookup'
import { shelfSelectorFields } from './shelf-scope'

const names = z.array(z.string().min(1).max(1024)).min(1).max(FILENAME_LOOKUP_MAX_NAMES)

export const byNameRequestSchema = z.object({ ...shelfSelectorFields, names })

export const byNameResponseSchema = z.object({
  documents: z.array(
    z
      .object({ id: z.string(), filename: z.string(), createdAt: z.string() })
      .passthrough()
  ),
})
