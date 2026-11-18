import 'server-only'
import { createHash } from 'node:crypto'
import { getPlatformRetrievalSettings } from '@/lib/retrieval-settings/service'

export const LESSONS_HOLDOUT_SETTING_KEY = 'lessons.holdout_pct'

export function isInHoldoutSlice(conversationId: string, holdoutPct: number): boolean {
  if (holdoutPct <= 0 || !conversationId) return false
  if (holdoutPct >= 100) return true
  const digest = createHash('sha256').update(conversationId).digest()
  return digest.readUInt32BE(0) % 100 < holdoutPct
}

export async function resolveLessonsHoldout(
  conversationId: string | null | undefined
): Promise<boolean | null> {
  if (!conversationId) return null
  try {
    const settings = await getPlatformRetrievalSettings()
    const pct = settings[LESSONS_HOLDOUT_SETTING_KEY]
    if (!pct || pct <= 0) return null
    return isInHoldoutSlice(conversationId, pct)
  } catch {
    return null
  }
}
