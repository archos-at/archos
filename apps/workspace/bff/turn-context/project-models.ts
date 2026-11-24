import { isDrawingMeasureEnabled } from '@/lib/authz/feature-flags'
import type { UserSession } from '@/lib/auth/types'
import type { ProjectModelKinds } from '@/lib/bim/model-kinds-repository'

export function turnProjectModels(
  kinds: ProjectModelKinds | null,
  session: Pick<UserSession, 'featureFlags'>,
): ProjectModelKinds | null {
  return kinds && { ...kinds, pdf: kinds.pdf && isDrawingMeasureEnabled(session) }
}
