import 'server-only'
import { asc, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { getCached, invalidateCached } from '@/lib/cache'
import { invalidateEveryBackendModelConfig } from './backend-key'
import { platformModelDefaults, type PlatformModelDefault } from '@/lib/db/schema/platform-model-defaults'
import { AGENT_GROUP_IDS } from './agent-groups'

const DEFAULTS_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULTS_CACHE_KEY = 'platformmodeldefaults'

export type PlatformDefaultsExecutor = Pick<ReturnType<typeof getDb>, 'transaction'>

export type PlatformModelDefaults = Record<string, string>

export interface PlatformModelDefaultInput {
  defaults: PlatformModelDefaults
  modelSnapshot: Record<string, unknown>
  note: string | null
  actorUserId: string
  actorEmail: string | null
}

export async function getPlatformModelDefaults(): Promise<PlatformModelDefaults> {
  return getCached(DEFAULTS_CACHE_KEY, DEFAULTS_CACHE_TTL_MS, readPlatformModelDefaults)
}

async function readPlatformModelDefaults(): Promise<PlatformModelDefaults> {
  const db = getDb()
  const rows = await withPlatformAccess(
    'platform model defaults are fleet-wide configuration, owned by no tenant',
    () =>
      db
        .select({
          agentGroup: platformModelDefaults.agentGroup,
          model: platformModelDefaults.model,
        })
        .from(platformModelDefaults)
  )
  const flat: PlatformModelDefaults = {}
  for (const row of rows) {
    if (AGENT_GROUP_IDS.includes(row.agentGroup)) flat[row.agentGroup] = row.model
  }
  return flat
}

export async function listPlatformModelDefaults(): Promise<PlatformModelDefault[]> {
  const db = getDb()
  return withPlatformAccess(
    'platform model defaults are fleet-wide configuration, owned by no tenant',
    () => db.select().from(platformModelDefaults).orderBy(asc(platformModelDefaults.agentGroup))
  )
}

function platformDefaultsEqual(a: PlatformModelDefaults, b: PlatformModelDefaults): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key])
}

export async function savePlatformModelDefaults(
  input: PlatformModelDefaultInput,
  executor?: PlatformDefaultsExecutor
): Promise<PlatformModelDefault[]> {
  const db = executor ?? getDb()
  const entries = Object.entries(input.defaults)
  const keep = entries.map(([agentGroup]) => agentGroup)

  let previous: PlatformModelDefaults | null = null
  try {
    previous = await readPlatformModelDefaults()
  } catch {
    previous = null
  }

  const rows = await withPlatformAccess(
    'platform model defaults are fleet-wide configuration, owned by no tenant',
    () =>
      db.transaction(async (tx) => {
        if (keep.length === 0) {
          await tx.delete(platformModelDefaults)
        } else {
          const stale = await tx
            .select({ agentGroup: platformModelDefaults.agentGroup })
            .from(platformModelDefaults)
          const drop = stale.map((row) => row.agentGroup).filter((group) => !keep.includes(group))
          if (drop.length > 0) {
            await tx
              .delete(platformModelDefaults)
              .where(inArray(platformModelDefaults.agentGroup, drop))
          }
        }

        for (const [agentGroup, model] of entries) {
          await tx
            .insert(platformModelDefaults)
            .values({
              agentGroup,
              model,
              modelSnapshot: input.modelSnapshot[agentGroup] ?? null,
              note: input.note,
              updatedBy: input.actorUserId,
              updatedByEmail: input.actorEmail,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: platformModelDefaults.agentGroup,
              set: {
                model,
                modelSnapshot: input.modelSnapshot[agentGroup] ?? null,
                note: input.note,
                updatedBy: input.actorUserId,
                updatedByEmail: input.actorEmail,
                updatedAt: new Date(),
              },
            })
        }

        return tx
          .select()
          .from(platformModelDefaults)
          .orderBy(asc(platformModelDefaults.agentGroup))
      })
  )

  await invalidatePlatformModelDefaults({
    backend: previous === null || !platformDefaultsEqual(previous, input.defaults),
  })
  return rows
}

export async function invalidatePlatformModelDefaults(options: { backend?: boolean } = {}): Promise<void> {
  const { backend = true } = options
  await invalidateCached(DEFAULTS_CACHE_KEY)
  if (backend) {
    await invalidateEveryBackendModelConfig()
  }
}
