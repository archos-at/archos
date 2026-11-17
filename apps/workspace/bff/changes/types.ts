import { z } from 'zod'

export const AGENT_CHANGE_OBJECTS = ['annotation', 'annotation_reply'] as const
export type AgentChangeObject = (typeof AGENT_CHANGE_OBJECTS)[number]

export const AGENT_CHANGE_OPS = ['create', 'update', 'delete'] as const
export type AgentChangeOp = (typeof AGENT_CHANGE_OPS)[number]

export const changeStateSchema = z.record(z.string(), z.unknown())
export type ChangeState = z.infer<typeof changeStateSchema>

export const UNDO_REFUSALS = [
  'moved-on',
  'already-undone',
] as const
export type UndoRefusal = (typeof UNDO_REFUSALS)[number]

export const agentChangeViewSchema = z
  .object({
    id: z.guid(),
    documentId: z.guid(),
    annotationId: z.guid(),
    annotationNumber: z.number().int().positive().nullable(),
    objectKind: z.enum(AGENT_CHANGE_OBJECTS),
    objectId: z.guid(),
    op: z.enum(AGENT_CHANGE_OPS),
    before: changeStateSchema.nullable(),
    after: changeStateSchema.nullable(),
    onBehalfOf: z.string(),
    onBehalfOfName: z.string().nullable(),
    createdAt: z.string(),
    undoneAt: z.string().nullable(),
    undoneBy: z.string().nullable(),
    undoneByName: z.string().nullable(),
    canUndo: z.boolean(),
  })
  .strict()
export type AgentChangeView = z.infer<typeof agentChangeViewSchema>

export const turnChangesResponseSchema = z.object({ changes: z.array(agentChangeViewSchema) }).strict()
export type TurnChangesResponse = z.infer<typeof turnChangesResponseSchema>

export const undoChangeResponseSchema = z.object({ change: agentChangeViewSchema }).strict()
export type UndoChangeResponse = z.infer<typeof undoChangeResponseSchema>
