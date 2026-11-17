import { z } from 'zod'
import { DIAGRAM_SOURCE_KINDS, MAX_DIAGRAM_SOURCE_BYTES, MAX_DIAGRAM_SVG_BYTES } from './diagram-sources'

export const fileDiagramSchema = z.object({
  runId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Unique to this diagram, derived from the answer it was drawn in and its source; the same runId files nothing twice'
    ),
  title: z.string().min(1).max(200),
  sourceKind: z.enum(DIAGRAM_SOURCE_KINDS),
  source: z.string().min(1).max(MAX_DIAGRAM_SOURCE_BYTES),
  svg: z.string().min(1).max(MAX_DIAGRAM_SVG_BYTES),
  conversationId: z.string().min(1).max(128).optional(),
  answerId: z.string().min(1).max(128).optional(),
  edited: z
    .boolean()
    .optional()
    .describe('True when a person edited the drawing before filing it; the files then name both authors'),
})
