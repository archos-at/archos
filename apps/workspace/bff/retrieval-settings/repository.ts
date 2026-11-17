import 'server-only'
import { asc, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { platformRetrievalSettings, type PlatformRetrievalSetting } from '@/lib/db/schema/platform-retrieval-settings'
import { RETRIEVAL_SETTING_KEYS } from './catalog'

const MAX_SETTING_ROWS = RETRIEVAL_SETTING_KEYS.length * 4

export async function listPlatformRetrievalSettingRows(): Promise<PlatformRetrievalSetting[]> {
  const db = getDb()
  return withPlatformAccess(
    'platform retrieval settings are fleet-wide configuration, owned by no tenant',
    () =>
      db
        .select()
        .from(platformRetrievalSettings)
        .orderBy(asc(platformRetrievalSettings.key))
        .limit(MAX_SETTING_ROWS)
  )
}

export interface PlatformRetrievalSettingsWriteInput {
  settings: Record<string, number>
  note: string | null
  actorUserId: string
  actorEmail: string | null
}

export async function replacePlatformRetrievalSettings(
  input: PlatformRetrievalSettingsWriteInput
): Promise<PlatformRetrievalSetting[]> {
  const db = getDb()
  const entries = Object.entries(input.settings)
  const keep = entries.map(([key]) => key)

  return withPlatformAccess(
    'platform retrieval settings are fleet-wide configuration, owned by no tenant',
    () =>
      db.transaction(async (tx) => {
        const stored = await tx
          .select({ key: platformRetrievalSettings.key, value: platformRetrievalSettings.value })
          .from(platformRetrievalSettings)
          .limit(MAX_SETTING_ROWS)

        const drop = stored.map((row) => row.key).filter((key) => !keep.includes(key))
        if (drop.length > 0) {
          await tx
            .delete(platformRetrievalSettings)
            .where(inArray(platformRetrievalSettings.key, drop))
        }

        const storedValues = new Map(stored.map((row) => [row.key, row.value]))
        for (const [key, value] of entries) {
          if (storedValues.get(key) === value) continue
          await tx
            .insert(platformRetrievalSettings)
            .values({
              key,
              value,
              note: input.note,
              updatedBy: input.actorUserId,
              updatedByEmail: input.actorEmail,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: platformRetrievalSettings.key,
              set: {
                value,
                note: input.note,
                updatedBy: input.actorUserId,
                updatedByEmail: input.actorEmail,
                updatedAt: new Date(),
              },
            })
        }

        return tx
          .select()
          .from(platformRetrievalSettings)
          .orderBy(asc(platformRetrievalSettings.key))
          .limit(MAX_SETTING_ROWS)
      })
  )
}
