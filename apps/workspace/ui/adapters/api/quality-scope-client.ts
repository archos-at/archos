import type { QualityScopeOptions } from '@/lib/quality/scope-options'
import { ApiRequestError } from './api-error'

export type { QualityScopeOptions }

export const getQualityScopeOptions = async (
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<QualityScopeOptions> => {
  const response = await fetch(`/api/platform/quality/scope-options?${query}`, { signal: options.signal })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to load quality scope options: ${response.status}`, response.status)
  }
  return (await response.json()) as QualityScopeOptions
}
