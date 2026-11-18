'use client'

import type { Locale } from '@/i18n/config'
import type { ThemeMode } from '@/features/layout/types'

export interface UserPreferences {
  locale?: Locale
  theme?: ThemeMode
  activeProjectId?: string
  showReasoningSkills?: boolean
  tourWelcomeSeenAt?: string
  tourProjectSeenAt?: string
  [key: string]: unknown
}

export const SHOW_REASONING_SKILLS_DEFAULT = false

export function readShowReasoningSkills(prefs: UserPreferences | null | undefined): boolean {
  return typeof prefs?.showReasoningSkills === 'boolean'
    ? prefs.showReasoningSkills
    : SHOW_REASONING_SKILLS_DEFAULT
}

export async function setShowReasoningSkills(value: boolean): Promise<boolean> {
  return patchUserPreferences({ showReasoningSkills: value })
}

export async function fetchUserPreferences(): Promise<UserPreferences> {
  try {
    const res = await fetch('/api/user/preferences', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return {}
    const data = (await res.json()) as { prefs?: UserPreferences }
    return data.prefs ?? {}
  } catch {
    return {}
  }
}

export async function patchUserPreferences(patch: Partial<UserPreferences>): Promise<boolean> {
  try {
    const res = await fetch('/api/user/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: patch }),
    })
    return res.ok
  } catch {
    return false
  }
}
