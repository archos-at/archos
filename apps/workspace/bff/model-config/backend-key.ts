import { invalidateCached, invalidateCachedPrefix } from '@/lib/cache'

const PREFIX = 'modelconfig:'

export const backendModelConfigKey = (organizationId: string): string => `${PREFIX}${organizationId}`

export async function invalidateBackendModelConfig(organizationId: string): Promise<void> {
  await invalidateCached(backendModelConfigKey(organizationId))
}

export async function invalidateEveryBackendModelConfig(): Promise<void> {
  await invalidateCachedPrefix(PREFIX)
}
