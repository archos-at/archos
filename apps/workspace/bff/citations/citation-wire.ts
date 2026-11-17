import { z } from 'zod'

const MAX_ITEMS = 64

export const formatCitationsSchema = z.object({
  format: z.enum(['apa', 'bibtex', 'ris']),
  items: z.array(z.record(z.string(), z.unknown())).max(MAX_ITEMS),
})
