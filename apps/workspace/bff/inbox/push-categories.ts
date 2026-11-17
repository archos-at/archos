import { z } from 'zod'

export const PUSH_CATEGORIES = ['requests', 'results', 'access', 'activity', 'office'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]

export const PUSH_CATEGORY_DEFAULTS: Readonly<Record<PushCategory, boolean>> = {
  requests: true,
  results: true,
  access: true,
  activity: false,
  office: true,
}

export type PushUrgency = 'high' | 'normal' | 'low'

export interface PushPreferences {
  showContent: boolean
  categories: Record<PushCategory, boolean>
}

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  showContent: true,
  categories: { ...PUSH_CATEGORY_DEFAULTS },
}

export const pushPreferencesPatchSchema = z
  .object({
    showContent: z.boolean().optional(),
    categories: z
      .object({
        requests: z.boolean().optional(),
        results: z.boolean().optional(),
        access: z.boolean().optional(),
        activity: z.boolean().optional(),
        office: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type PushPreferencesPatch = z.infer<typeof pushPreferencesPatchSchema>

export function resolvePushPreferences(raw: unknown): PushPreferences {
  const bag = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const stored =
    typeof bag.categories === 'object' && bag.categories !== null ? (bag.categories as Record<string, unknown>) : {}
  const categories = { ...PUSH_CATEGORY_DEFAULTS }
  for (const category of PUSH_CATEGORIES) {
    const value = stored[category]
    if (typeof value === 'boolean') categories[category] = value
  }
  return { showContent: typeof bag.showContent === 'boolean' ? bag.showContent : true, categories }
}

export function applyPushPreferencesPatch(current: PushPreferences, patch: PushPreferencesPatch): PushPreferences {
  const categories = { ...current.categories }
  for (const category of PUSH_CATEGORIES) {
    const value = patch.categories?.[category]
    if (typeof value === 'boolean') categories[category] = value
  }
  return { showContent: patch.showContent ?? current.showContent, categories }
}
