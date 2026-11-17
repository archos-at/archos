import 'server-only'
import { getCached, invalidateCached } from '@/lib/cache'
import type { PlatformRetrievalSetting } from '@/lib/db/schema/platform-retrieval-settings'
import { UnprocessableError } from '@/lib/api/errors'
import {
  RETRIEVAL_SETTINGS,
  RETRIEVAL_SETTING_KEYS,
  retrievalSettingDefaults,
  validateRetrievalSettingValue,
} from './catalog'
import { listPlatformRetrievalSettingRows, replacePlatformRetrievalSettings } from './repository'

const SETTINGS_CACHE_TTL_MS = 60 * 1000
const SETTINGS_CACHE_KEY = 'platformretrievalsettings'

export type PlatformRetrievalSettings = Record<string, number>

export async function getPlatformRetrievalSettings(): Promise<PlatformRetrievalSettings> {
  return getCached(SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL_MS, async () => {
    const rows = await listPlatformRetrievalSettingRows()
    const flat: PlatformRetrievalSettings = {}
    for (const row of rows) {
      if (RETRIEVAL_SETTING_KEYS.includes(row.key)) flat[row.key] = row.value
    }
    return flat
  })
}

export interface PlatformRetrievalSettingView {
  key: string
  value: number
  defaultValue: number
  overridden: boolean
  note: string | null
  updatedByEmail: string | null
  updatedAt: Date | null
}

export async function listPlatformRetrievalSettings(): Promise<PlatformRetrievalSettingView[]> {
  const defaults = retrievalSettingDefaults()
  const rows = await listPlatformRetrievalSettingRows()
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return RETRIEVAL_SETTINGS.map((definition) => {
    const row = byKey.get(definition.key)
    return {
      key: definition.key,
      value: row?.value ?? defaults[definition.key],
      defaultValue: definition.defaultValue,
      overridden: row !== undefined,
      note: row?.note ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
      updatedAt: row?.updatedAt ?? null,
    }
  })
}

export interface SavePlatformRetrievalSettingsInput {
  settings: Record<string, number>
  note: string | null
  actorUserId: string
  actorEmail: string | null
}

export async function savePlatformRetrievalSettings(
  input: SavePlatformRetrievalSettingsInput
): Promise<PlatformRetrievalSetting[]> {
  const errors: string[] = []
  for (const [key, value] of Object.entries(input.settings)) {
    if (typeof value !== 'number') {
      errors.push(`${key}: Zahl erforderlich`)
      continue
    }
    const error = validateRetrievalSettingValue(key, value)
    if (error) errors.push(error)
  }
  if (errors.length > 0) {
    throw new UnprocessableError('Ungültige Abruf-Einstellungen', { errors })
  }

  const rows = await replacePlatformRetrievalSettings(input)
  await invalidateCached(SETTINGS_CACHE_KEY)
  return rows
}

export async function invalidatePlatformRetrievalSettings(): Promise<void> {
  await invalidateCached(SETTINGS_CACHE_KEY)
}
