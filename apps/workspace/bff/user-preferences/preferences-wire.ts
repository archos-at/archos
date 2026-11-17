import { z } from 'zod'

export const updatePreferencesSchema = z.object({
  prefs: z.record(z.string(), z.unknown()),
})
