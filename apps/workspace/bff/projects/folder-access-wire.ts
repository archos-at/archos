import { z } from 'zod'

export const FOLDER_ACCESS_MAX_PEOPLE = 50

const folderPersonSchema = z
  .object({
    userId: z.string().trim().min(1).max(100),
    level: z.enum(['read', 'write']),
  })
  .strict()

export const folderAccessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z
    .object({
      mode: z.literal('custom'),
      everyoneReads: z.boolean(),
      people: z.array(folderPersonSchema).max(FOLDER_ACCESS_MAX_PEOPLE),
    })
    .strict(),
])
