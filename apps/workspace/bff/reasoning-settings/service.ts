import 'server-only'
import { asc, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { getCached, invalidateCached } from '@/lib/cache'
import { platformReasoningEfforts, type PlatformReasoningEffort } from '@/lib/db/schema/platform-reasoning-efforts'
import { AGENT_GROUP_IDS } from '@/lib/model-config/agent-groups'
import { isReasoningEffort, type ReasoningEffort } from './catalog'

const EFFORTS_CACHE_TTL_MS = 60 * 1000
const EFFORTS_CACHE_KEY = 'platformreasoningefforts'

export type PlatformReasoningEfforts = Record<string, ReasoningEffort>

export interface PlatformReasoningEffortInput {
  efforts: PlatformReasoningEfforts
  note: string | null
  actorUserId: string
  actorEmail: string | null
}

export async function getPlatformReasoningEfforts(): Promise<PlatformReasoningEfforts> {
  return getCached(EFFORTS_CACHE_KEY, EFFORTS_CACHE_TTL_MS, async () => {
    const db = getDb()
    const rows = await db
      .select({
        agentGroup: platformReasoningEfforts.agentGroup,
        effort: platformReasoningEfforts.effort,
      })
      .from(platformReasoningEfforts)
    const flat: PlatformReasoningEfforts = {}
    for (const row of rows) {
      if (AGENT_GROUP_IDS.includes(row.agentGroup) && isReasoningEffort(row.effort)) {
        flat[row.agentGroup] = row.effort
      }
    }
    return flat
  })
}

export async function listPlatformReasoningEfforts(): Promise<PlatformReasoningEffort[]> {
  const db = getDb()
  return db.select().from(platformReasoningEfforts).orderBy(asc(platformReasoningEfforts.agentGroup))
}

export async function savePlatformReasoningEfforts(
  input: PlatformReasoningEffortInput,
): Promise<PlatformReasoningEffort[]> {
  const db = getDb()
  const entries = Object.entries(input.efforts)
  const keep = entries.map(([agentGroup]) => agentGroup)

  const rows = await db.transaction(async (tx) => {
    if (keep.length === 0) {
      await tx.delete(platformReasoningEfforts)
    } else {
      const stale = await tx
        .select({ agentGroup: platformReasoningEfforts.agentGroup })
        .from(platformReasoningEfforts)
      const drop = stale.map((row) => row.agentGroup).filter((group) => !keep.includes(group))
      if (drop.length > 0) {
        await tx
          .delete(platformReasoningEfforts)
          .where(inArray(platformReasoningEfforts.agentGroup, drop))
      }
    }

    for (const [agentGroup, effort] of entries) {
      await tx
        .insert(platformReasoningEfforts)
        .values({
          agentGroup,
          effort,
          note: input.note,
          updatedBy: input.actorUserId,
          updatedByEmail: input.actorEmail,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformReasoningEfforts.agentGroup,
          set: {
            effort,
            note: input.note,
            updatedBy: input.actorUserId,
            updatedByEmail: input.actorEmail,
            updatedAt: new Date(),
          },
        })
    }

    return tx
      .select()
      .from(platformReasoningEfforts)
      .orderBy(asc(platformReasoningEfforts.agentGroup))
  })

  await invalidatePlatformReasoningEfforts()
  return rows
}

export async function invalidatePlatformReasoningEfforts(): Promise<void> {
  await invalidateCached(EFFORTS_CACHE_KEY)
}
