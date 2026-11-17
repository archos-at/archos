import { z } from 'zod'

export const CLEANUP_MAX_DOCUMENTS = 2000

const ids = z.array(z.guid()).max(CLEANUP_MAX_DOCUMENTS)

export const confirmCleanupSchema = z.object({ documentIds: ids, proposedIds: ids, aiUsed: z.boolean() }).strict()

export const proposeCleanupSchema = z.object({ locale: z.enum(['de', 'en']) }).strict()
