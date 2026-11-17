import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { memoryTopicField, memoryTopicQueryField, memoryTopicRenameSchema } from '@/lib/memory-topics/wire'
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

export const listPersonalMemoryQuerySchema = z.object({
  ...pageQueryShape,
  sourceConversationId: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      'Only the notes saved from this conversation. Each note names the answer it was saved under in `sourceMessageId`.'
    ),
  topic: memoryTopicQueryField,
})

export const createPersonalMemorySchema = z.object({
  kind,
  content,
  pinned: z.boolean().optional().describe('A pinned note reaches every turn first.'),
  topic: memoryTopicField.optional(),
})

export const patchPersonalMemorySchema = z
  .object({
    kind: kind.optional(),
    content: content.optional(),
    pinned: z.boolean().optional(),
    topic: memoryTopicField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Empty patch' })

export const deletePersonalMemoryTopicSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Topic to remove, as topics names it; its notes are deleted.'),
})

export const renamePersonalMemoryTopicSchema = memoryTopicRenameSchema

export type CreatePersonalMemoryInput = z.infer<typeof createPersonalMemorySchema>
export type PatchPersonalMemoryInput = z.infer<typeof patchPersonalMemorySchema>

export const internalPersonalMemorySchema = z
  .object({
    kind,
    content,
    provenanceType: z.enum(['agent', 'distillation']).default('agent'),
    sourceConversationId: z.string().max(255).optional(),
    sourceMessageId: z.guid().optional(),
    topic: memoryTopicField.optional(),
  })
  .strict()

export type InternalPersonalMemoryInput = z.infer<typeof internalPersonalMemorySchema>

export const internalForgetPersonalMemorySchema = z.object({ content }).strict()
