import { z } from 'zod'
import { knowledgeContextSchema } from '@/lib/base-knowledge/context/wire'

export const turnContextRequestSchema = z.object({
  query: z.string().trim().max(2000).optional(),
}).strict()

export const turnContextResponseSchema = z.object({
  projectContext: z.string().nullable(),
  projectMemory: z.string().nullable(),
  orgInstructions: z.string().nullable(),
  personalMemory: z.string().nullable(),
  temporary: z.boolean(),
  drewOnOtherProjects: z.boolean(),
  referenceProjects: z.string().nullable(),
  workspace: z.string().nullable(),
  baseKnowledge: z.string().nullable(),
  baseKnowledgeLabels: z.array(z.record(z.string(), z.unknown())),
  knowledgeContext: knowledgeContextSchema,
  projectModels: z.object({ ifc: z.boolean(), dxf: z.boolean() }).strict().nullable(),
}).strict()

export const turnContextApiResponseSchema = z.object({ data: turnContextResponseSchema }).strict()

export type TurnContextRequest = z.infer<typeof turnContextRequestSchema>
export type TurnContextResponse = z.infer<typeof turnContextResponseSchema>
export type TurnContextApiResponse = z.infer<typeof turnContextApiResponseSchema>
