import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { memoryTopicField, memoryTopicQueryField } from '@/lib/memory-topics/wire'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import {
  PROJECT_MEMORY_CONFIDENCES,
  PROJECT_MEMORY_KINDS,
  PROJECT_MEMORY_STATUSES,
  PROJECT_MEMORY_VERIFICATIONS,
} from './memory-vocabulary'

export const listMemoryQuerySchema = z.object({
  includeArchived: z.string().optional(),
  conversationId: z.string().optional(),
  topic: memoryTopicQueryField,
  ...pageQueryShape,
})

export const listOrganizationMemoryQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional().describe('"true" includes archived.'),
  conversationId: z.string().min(1).max(255).optional().describe('This conversation only.'),
  topic: memoryTopicQueryField,
  ...pageQueryShape,
})

export const createMemorySchema = z.object({
  kind: z.enum(PROJECT_MEMORY_KINDS),
  content: z.string().trim().min(1).max(2000),
  confidence: z.enum(PROJECT_MEMORY_CONFIDENCES).optional(),
  pinned: z.boolean().optional(),
  topic: memoryTopicField.optional(),
})

export const patchMemorySchema = z
  .object({
    kind: z.enum(PROJECT_MEMORY_KINDS).optional(),
    content: z.string().trim().min(1).max(2000).optional(),
    status: z.enum(PROJECT_MEMORY_STATUSES).optional(),
    confidence: z.enum(PROJECT_MEMORY_CONFIDENCES).optional(),
    verification: z.enum(PROJECT_MEMORY_VERIFICATIONS).optional(),
    pinned: z.boolean().optional(),
    topic: memoryTopicField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Empty patch' })

export type ProjectMemoryWireItem = Omit<ProjectMemoryItem, 'embedding' | 'embeddingModel' | 'embeddedAt'>

export function toMemoryWireItem(item: ProjectMemoryItem): ProjectMemoryWireItem {
  const { embedding: _embedding, embeddingModel: _model, embeddedAt: _at, ...wire } = item
  return wire
}
