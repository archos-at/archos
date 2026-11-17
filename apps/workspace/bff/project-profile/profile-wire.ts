import { z } from 'zod'
import { ProjectProfilePatchOperationSchema } from './types'

const fieldSchema = z.object({ field: z.string(), value: z.string() })

export const consistencyCheckSchema = z.object({
  freeText: z.array(fieldSchema).max(50),
  structured: z.array(fieldSchema).max(200).optional(),
  locale: z.string().optional(),
})

export const patchProfileSchema = z.object({
  patch: z.array(ProjectProfilePatchOperationSchema),
  conversationId: z.string().min(1).max(128).optional(),
})

export const generateSummaryRequestSchema = z.object({
  locale: z
    .string()
    .optional()
    .describe('The language to write the summary in, "de" or "en". Defaults to the person’s UI language.'),
})

export function toProfileWire<T extends { profilePromptView?: unknown }>(
  state: T
): Omit<T, 'profilePromptView'> {
  const { profilePromptView: _promptView, ...wire } = state
  return wire
}
