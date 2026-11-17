import { z } from 'zod'

export const MEMORY_TOPIC_MAX_LENGTH = 40

export const MEMORY_TOPIC_WIRE_MAX_CHARS = 200

export const memoryTopicField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .nullable()
  .describe(`1–3 words in the person's language; reuse a topic. null: none.`)

export const memoryTopicRenameSchema = z.object({
  from: z
    .string()
    .min(1)
    .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
    .nullable()
    .describe('Topic to rename. null: no topic.'),
  to: memoryTopicField.describe('New name; an existing one merges. null: none.'),
})

export const memoryTopicQueryField = z
  .string()
  .max(MEMORY_TOPIC_WIRE_MAX_CHARS)
  .optional()
  .describe('This topic only; empty: none.')
