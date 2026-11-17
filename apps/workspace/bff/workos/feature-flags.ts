import { getWorkOS } from './client'
import { getCached, invalidateCached } from '@/lib/cache'
import {
  acceptedFlagKeysOf,
  FEATURE_FLAGS,
  flagsFromWorkOS,
  unauthenticatedDefault,
  type KnownFeatureFlag,
} from '@/lib/authz/feature-flags'

const CACHE_TTL_MS = 30_000

async function enabledSlugsForOrg(organizationId: string): Promise<Set<string>> {
  const slugs = await getCached(`flags:${organizationId}`, CACHE_TTL_MS, async () => {
    const list = await getWorkOS().featureFlags.listOrganizationFeatureFlags({ organizationId })
    const flags = await list.autoPagination()
    return flags.map((flag) => flag.slug)
  })
  return new Set(slugs)
}

export async function enabledFlagsForOrganization(organizationId: string): Promise<string[]> {
  if (!process.env.WORKOS_API_KEY) return []
  return [...(await enabledSlugsForOrg(organizationId))]
}

export async function isOrgFeatureEnabled(
  flag: KnownFeatureFlag,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!flagsFromWorkOS()) return unauthenticatedDefault(flag)
  if (!organizationId || !process.env.WORKOS_API_KEY) return false
  try {
    const enabled = await enabledSlugsForOrg(organizationId)
    return acceptedFlagKeysOf(flag).some((key) => enabled.has(key))
  } catch (error) {
    console.warn(`[FeatureFlags] evaluation of "${flag}" failed; treating it as off`, error)
    return false
  }
}

export interface PostAnswerStageFlag {
  readonly id: string
  readonly flag: KnownFeatureFlag
}

export const POST_ANSWER_STAGE_FLAGS: readonly PostAnswerStageFlag[] = [
  {
    id: 'memory_reflection',
    flag: 'memory-reflection',
  },
  {
    id: 'follow_ups',
    flag: 'post-answer-follow-ups',
  },
]

export async function enabledPostAnswerStages(
  organizationId: string | null | undefined,
): Promise<string[]> {
  const decisions = await Promise.all(
    POST_ANSWER_STAGE_FLAGS.map(async (stage) =>
      (await isOrgFeatureEnabled(stage.flag, organizationId)) ? stage.id : null,
    ),
  )
  return decisions.filter((id): id is string => id !== null)
}

export async function isMemoryReflectionEnabled(
  organizationId: string | null | undefined,
): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.memoryReflection, organizationId)
}

export async function isDeepResearchEnabledForOrg(
  organizationId: string | null | undefined,
): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.deepResearch, organizationId)
}

export async function isTaskAutomationEnabledForOrg(
  organizationId: string | null | undefined,
): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.taskAutomation, organizationId)
}

export async function _clearFeatureFlagCache(organizationId?: string): Promise<void> {
  if (organizationId) {
    await invalidateCached(`flags:${organizationId}`)
  }
}
