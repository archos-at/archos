import type { QualityScope } from './scope'

export const MAX_SCOPE_IDS = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function scopeIdsError(
  scope: Pick<QualityScope, 'organizationIds' | 'projectIds'>
): { error: 'too_many_values' | 'invalid_value'; param: 'org' | 'project' } | null {
  if (scope.organizationIds.length > MAX_SCOPE_IDS) return { error: 'too_many_values', param: 'org' }
  if (scope.projectIds.length > MAX_SCOPE_IDS) return { error: 'too_many_values', param: 'project' }
  if (scope.projectIds.some((id) => !UUID.test(id))) return { error: 'invalid_value', param: 'project' }
  return null
}
