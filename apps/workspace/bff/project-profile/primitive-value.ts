import { z } from 'zod'

export const ProjectPrimitiveValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export type ProjectPrimitiveValue = z.infer<typeof ProjectPrimitiveValueSchema>
