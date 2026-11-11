/**
 * The bodies of the personal memory routes (`/api/user/memory`), kept out of
 * the route files so the routes and the agent catalog
 * (`bff/agent-api/catalog/collaboration.ts`) parse against one schema.
 */

import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { PERSONAL_MEMORY_KINDS, PERSONAL_MEMORY_MAX_CONTENT_CHARS } from './vocabulary'

const content = z
  .string()
  .trim()
  .min(1)
  .max(PERSONAL_MEMORY_MAX_CONTENT_CHARS)
  .describe(`One self-contained sentence about the person, max ${PERSONAL_MEMORY_MAX_CONTENT_CHARS} characters.`)

const kind = z
  .enum(PERSONAL_MEMORY_KINDS)
  .describe(
    '`preference`: how the person wants the agent to work. `profile`: their role, responsibilities and recurring topics.'
  )

/** `GET /api/user/memory`: one lean page, `limit` and the previous page's `nextCursor`. */
export const listPersonalMemoryQuerySchema = z.object(pageQueryShape)

export const createPersonalMemorySchema = z.object({
  kind,
  content,
  pinned: z.boolean().optional().describe('A pinned note reaches every turn first.'),
})

export const patchPersonalMemorySchema = z
  .object({
    kind: kind.optional(),
    content: content.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Empty patch' })

export type CreatePersonalMemoryInput = z.infer<typeof createPersonalMemorySchema>
export type PatchPersonalMemoryInput = z.infer<typeof patchPersonalMemorySchema>

/**
 * The body of `POST /api/internal/personal-memory`, the agent's write path.
 * Strict, and with no owner field: the note belongs to the person of the
 * verified request envelope, so a body that names a `userId` is a 400. Only
 * the agent-side provenances; a person's own note comes through the panel
 * route. `distillation` is the reflection stage after an answer.
 */
export const internalPersonalMemorySchema = z
  .object({
    kind,
    content,
    provenanceType: z.enum(['agent', 'distillation']).default('agent'),
    sourceConversationId: z.string().max(255).optional(),
  })
  .strict()

export type InternalPersonalMemoryInput = z.infer<typeof internalPersonalMemorySchema>
