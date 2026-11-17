/**
 * The bodies of the personal memory routes (`/api/user/memory`), kept out of
 * the route files so the routes and the agent catalog
 * (`bff/agent-api/catalog/collaboration.ts`) parse against one schema.
 */

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

/**
 * `GET /api/user/memory`: one lean page, `limit` and the previous page's
 * `nextCursor`. With `sourceConversationId`, only the notes saved from that
 * conversation: each carries `sourceMessageId`, the answer it was saved under.
 * With `topic`, only the notes on that topic (an empty value: those with none).
 */
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

/**
 * `DELETE /api/user/memory/topics`: removes every note of the person on this
 * topic, for good. The name is the topic as the list names it.
 */
export const deletePersonalMemoryTopicSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Topic to remove, as topics names it; its notes are deleted.'),
})

/** `PATCH /api/user/memory/topics`: the same body as the project shelf's (`memoryTopicRenameSchema`). */
export const renamePersonalMemoryTopicSchema = memoryTopicRenameSchema

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
    /**
     * The answer the note was saved under: the id the agent derives for the
     * turn's answer message (`answer_message_id`) and the browser holds as
     * that message's id. Not verified against the envelope, which names the
     * conversation and no turn: it only decides under which of the OWNER's
     * own answers their own note is shown.
     */
    sourceMessageId: z.guid().optional(),
    /** The topic the agent files the note under: reused from the shelf when one matches (`resolveTopic`). */
    topic: memoryTopicField.optional(),
  })
  .strict()

export type InternalPersonalMemoryInput = z.infer<typeof internalPersonalMemorySchema>

/**
 * The body of `POST /api/internal/personal-memory/forget`, the agent's undo:
 * the text of the note to remove, as the agent's `PERSONAL_MEMORY` block showed
 * it. Strict and with no owner field, like the write.
 */
export const internalForgetPersonalMemorySchema = z.object({ content }).strict()
